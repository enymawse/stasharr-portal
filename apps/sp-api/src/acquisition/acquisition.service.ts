import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  StashdbAdapter,
  StashdbSceneDetails,
} from '../providers/stashdb/stashdb.adapter';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import {
  WhisparrAdapter,
  WhisparrAdapterBaseConfig,
  WhisparrMovieLookupResult,
  WhisparrQueueSnapshotItem,
} from '../providers/whisparr/whisparr.adapter';
import { SceneStatusDto } from '../scene-status/dto/scene-status.dto';
import { SceneStatusService } from '../scene-status/scene-status.service';
import {
  AcquisitionCountsByLifecycleDto,
  AcquisitionSceneItemDto,
  AcquisitionScenesFeedDto,
} from './dto/acquisition-scene-feed.dto';
import {
  AcquisitionLifecycle,
  AcquisitionLifecycleFilter,
} from './dto/acquisition-scenes-query.dto';

type RequestRowSnapshot = {
  stashId: string;
  updatedAt: Date;
};

type AcquisitionCandidate = {
  stashId: string;
  status: SceneStatusDto & { state: AcquisitionLifecycle };
  queueIndex: number | null;
  requestUpdatedAt: number | null;
  movieIndex: number | null;
  whisparrViewUrl: string | null;
};

@Injectable()
export class AcquisitionService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 25;
  private static readonly HYDRATION_BATCH_SIZE = 6;

  private readonly logger = new Logger(AcquisitionService.name);

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly sceneStatusService: SceneStatusService,
    private readonly prisma: PrismaService,
  ) {}

  async getScenesFeed(
    page = AcquisitionService.DEFAULT_PAGE,
    perPage = AcquisitionService.DEFAULT_PER_PAGE,
    lifecycle: AcquisitionLifecycleFilter = 'ANY',
  ): Promise<AcquisitionScenesFeedDto> {
    const stashdbConfig = await this.getStashdbConfig();
    const whisparrConfig = await this.getWhisparrConfig();
    const requestRows = await this.getRequestRows();
    const localEvidence = await this.getWhisparrEvidence(whisparrConfig);
    const candidateStashIds = this.buildCandidateStashIds(
      requestRows,
      localEvidence.queueStashIds,
      localEvidence.movies,
    );
    const statuses = await this.sceneStatusService.resolveForScenesWithEvidence(
      candidateStashIds,
      {
        queueItems: localEvidence.queueItems,
        movieByStashId: localEvidence.movieByStashId,
      },
    );
    const countsByLifecycle = this.initializeCountsByLifecycle();

    const activeCandidates = candidateStashIds
      .map((stashId) =>
        this.toAcquisitionCandidate(
          stashId,
          statuses.get(stashId),
          countsByLifecycle,
          requestRows,
          localEvidence,
          whisparrConfig,
        ),
      )
      .filter(
        (candidate): candidate is AcquisitionCandidate => candidate !== null,
      )
      .sort((left, right) => this.compareCandidates(left, right));

    const filteredCandidates =
      lifecycle === 'ANY'
        ? activeCandidates
        : activeCandidates.filter(
            (candidate) => candidate.status.state === lifecycle,
          );

    const total = filteredCandidates.length;
    const start = (page - 1) * perPage;
    const pageCandidates = filteredCandidates.slice(start, start + perPage);
    const hasMore = page * perPage < total;
    const items = await this.hydrateSceneCards(pageCandidates, stashdbConfig);

    return {
      total,
      page,
      perPage,
      hasMore,
      countsByLifecycle,
      items,
    };
  }

  private async hydrateSceneCards(
    candidates: AcquisitionCandidate[],
    stashdbConfig: { baseUrl: string; apiKey: string | null },
  ): Promise<AcquisitionSceneItemDto[]> {
    const items: AcquisitionSceneItemDto[] = [];

    for (
      let i = 0;
      i < candidates.length;
      i += AcquisitionService.HYDRATION_BATCH_SIZE
    ) {
      const batch = candidates.slice(
        i,
        i + AcquisitionService.HYDRATION_BATCH_SIZE,
      );
      const hydratedBatch = await Promise.all(
        batch.map(async (candidate) => {
          try {
            const scene = await this.stashdbAdapter.getSceneById(
              candidate.stashId,
              stashdbConfig,
            );
            return this.mapSceneToCard(scene, candidate);
          } catch (error) {
            this.logger.warn(
              `Falling back to minimal acquisition card due to metadata hydration failure: ${this.safeJson(
                {
                  stashId: candidate.stashId,
                  error: this.serializeError(error),
                },
              )}`,
            );
            return this.mapFallbackCard(candidate);
          }
        }),
      );

      items.push(...hydratedBatch);
    }

    return items;
  }

  private mapSceneToCard(
    scene: StashdbSceneDetails,
    candidate: AcquisitionCandidate,
  ): AcquisitionSceneItemDto {
    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      cardImageUrl: withStashImageSize(scene.imageUrl, 600),
      studioId: scene.studioId,
      studio: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      type: 'SCENE',
      source: 'STASHDB',
      status: candidate.status,
      whisparrViewUrl: candidate.whisparrViewUrl,
    };
  }

  private mapFallbackCard(
    candidate: AcquisitionCandidate,
  ): AcquisitionSceneItemDto {
    return {
      id: candidate.stashId,
      title: candidate.stashId,
      description: 'Scene metadata is unavailable in StashDB.',
      imageUrl: null,
      cardImageUrl: null,
      studioId: null,
      studio: null,
      studioImageUrl: null,
      releaseDate: null,
      duration: null,
      type: 'SCENE',
      source: 'STASHDB',
      status: candidate.status,
      whisparrViewUrl: candidate.whisparrViewUrl,
    };
  }

  private buildCandidateStashIds(
    requestRows: Map<string, RequestRowSnapshot>,
    queueStashIds: string[],
    movies: WhisparrMovieLookupResult[],
  ): string[] {
    const orderedIds: string[] = [];
    const seen = new Set<string>();

    for (const stashId of queueStashIds) {
      if (seen.has(stashId)) {
        continue;
      }

      seen.add(stashId);
      orderedIds.push(stashId);
    }

    for (const requestRow of requestRows.values()) {
      if (seen.has(requestRow.stashId)) {
        continue;
      }

      seen.add(requestRow.stashId);
      orderedIds.push(requestRow.stashId);
    }

    for (const movie of movies) {
      if (seen.has(movie.stashId)) {
        continue;
      }

      seen.add(movie.stashId);
      orderedIds.push(movie.stashId);
    }

    return orderedIds;
  }

  private toAcquisitionCandidate(
    stashId: string,
    status: SceneStatusDto | undefined,
    countsByLifecycle: AcquisitionCountsByLifecycleDto,
    requestRows: Map<string, RequestRowSnapshot>,
    localEvidence: {
      queueIndexByStashId: Map<string, number>;
      movieByStashId: Map<string, WhisparrMovieLookupResult>;
      movieIndexByStashId: Map<string, number>;
    },
    whisparrConfig: WhisparrAdapterBaseConfig | null,
  ): AcquisitionCandidate | null {
    if (!status || !this.isAcquisitionLifecycle(status.state)) {
      return null;
    }

    const acquisitionStatus: SceneStatusDto & { state: AcquisitionLifecycle } =
      {
        ...status,
        state: status.state,
      };

    countsByLifecycle[acquisitionStatus.state] += 1;

    const whisparrMovie = localEvidence.movieByStashId.get(stashId) ?? null;
    return {
      stashId,
      status: acquisitionStatus,
      queueIndex: localEvidence.queueIndexByStashId.get(stashId) ?? null,
      requestUpdatedAt: requestRows.get(stashId)?.updatedAt.getTime() ?? null,
      movieIndex: localEvidence.movieIndexByStashId.get(stashId) ?? null,
      whisparrViewUrl:
        whisparrConfig && whisparrMovie
          ? this.whisparrAdapter.buildSceneViewUrl(
              whisparrConfig.baseUrl,
              whisparrMovie.movieId,
            )
          : null,
    };
  }

  private compareCandidates(
    left: AcquisitionCandidate,
    right: AcquisitionCandidate,
  ): number {
    const lifecycleDelta =
      this.lifecycleSortRank(left.status.state) -
      this.lifecycleSortRank(right.status.state);
    if (lifecycleDelta !== 0) {
      return lifecycleDelta;
    }

    const queueRankDelta = this.nullableAscending(
      left.queueIndex,
      right.queueIndex,
    );
    if (queueRankDelta !== 0) {
      return queueRankDelta;
    }

    const requestDelta = this.nullableDescending(
      left.requestUpdatedAt,
      right.requestUpdatedAt,
    );
    if (requestDelta !== 0) {
      return requestDelta;
    }

    const movieDelta = this.nullableAscending(
      left.movieIndex,
      right.movieIndex,
    );
    if (movieDelta !== 0) {
      return movieDelta;
    }

    return left.stashId.localeCompare(right.stashId);
  }

  private nullableAscending(left: number | null, right: number | null): number {
    if (left === null && right === null) {
      return 0;
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    return left - right;
  }

  private nullableDescending(
    left: number | null,
    right: number | null,
  ): number {
    if (left === null && right === null) {
      return 0;
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    return right - left;
  }

  private lifecycleSortRank(state: AcquisitionLifecycle): number {
    switch (state) {
      case 'FAILED':
        return 0;
      case 'DOWNLOADING':
        return 1;
      case 'IMPORT_PENDING':
        return 2;
      case 'REQUESTED':
      default:
        return 3;
    }
  }

  private initializeCountsByLifecycle(): AcquisitionCountsByLifecycleDto {
    return {
      REQUESTED: 0,
      DOWNLOADING: 0,
      IMPORT_PENDING: 0,
      FAILED: 0,
    };
  }

  private isAcquisitionLifecycle(
    state: SceneStatusDto['state'],
  ): state is AcquisitionLifecycle {
    return (
      state === 'REQUESTED' ||
      state === 'DOWNLOADING' ||
      state === 'IMPORT_PENDING' ||
      state === 'FAILED'
    );
  }

  private async getRequestRows(): Promise<Map<string, RequestRowSnapshot>> {
    const requestRows = await this.prisma.request.findMany({
      select: {
        stashId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return new Map(
      requestRows.map((requestRow) => [
        requestRow.stashId,
        {
          stashId: requestRow.stashId,
          updatedAt: requestRow.updatedAt,
        },
      ]),
    );
  }

  private async getWhisparrEvidence(
    whisparrConfig: WhisparrAdapterBaseConfig | null,
  ): Promise<{
    queueItems: WhisparrQueueSnapshotItem[];
    queueStashIds: string[];
    queueIndexByStashId: Map<string, number>;
    movies: WhisparrMovieLookupResult[];
    movieByStashId: Map<string, WhisparrMovieLookupResult>;
    movieIndexByStashId: Map<string, number>;
  }> {
    if (!whisparrConfig) {
      return {
        queueItems: [],
        queueStashIds: [],
        queueIndexByStashId: new Map(),
        movies: [],
        movieByStashId: new Map(),
        movieIndexByStashId: new Map(),
      };
    }

    try {
      const [queueItems, movies] = await Promise.all([
        this.whisparrAdapter.getQueueSnapshot(whisparrConfig),
        this.whisparrAdapter.getMovieSnapshot(whisparrConfig),
      ]);
      const movieById = new Map<number, WhisparrMovieLookupResult>();
      const movieByStashId = new Map<string, WhisparrMovieLookupResult>();
      const movieIndexByStashId = new Map<string, number>();

      movies.forEach((movie, index) => {
        if (!movieById.has(movie.movieId)) {
          movieById.set(movie.movieId, movie);
        }

        if (movieByStashId.has(movie.stashId)) {
          this.logger.warn(
            `Skipping duplicate Whisparr movie snapshot stashId mapping: ${this.safeJson(
              {
                stashId: movie.stashId,
                movieId: movie.movieId,
              },
            )}`,
          );
          return;
        }

        movieByStashId.set(movie.stashId, movie);
        movieIndexByStashId.set(movie.stashId, index);
      });

      const queueStashIds: string[] = [];
      const queueIndexByStashId = new Map<string, number>();

      queueItems.forEach((queueItem) => {
        const movie = movieById.get(queueItem.movieId);
        if (!movie) {
          return;
        }

        if (queueIndexByStashId.has(movie.stashId)) {
          return;
        }

        queueIndexByStashId.set(movie.stashId, queueStashIds.length);
        queueStashIds.push(movie.stashId);
      });

      return {
        queueItems,
        queueStashIds,
        queueIndexByStashId,
        movies,
        movieByStashId,
        movieIndexByStashId,
      };
    } catch (error) {
      this.logger.error(
        `Failed to build Whisparr evidence for acquisition feed. error=${this.safeJson(
          this.serializeError(error),
        )}`,
      );
      return {
        queueItems: [],
        queueStashIds: [],
        queueIndexByStashId: new Map(),
        movies: [],
        movieByStashId: new Map(),
        movieIndexByStashId: new Map(),
      };
    }
  }

  private async getWhisparrConfig(): Promise<WhisparrAdapterBaseConfig | null> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.WHISPARR,
      );

      if (!integration.enabled) {
        return null;
      }

      if (integration.status !== IntegrationStatus.CONFIGURED) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      return {
        baseUrl,
        apiKey: integration.apiKey,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      this.logger.error(
        `Failed to resolve Whisparr integration config for acquisition feed. error=${this.safeJson(
          this.serializeError(error),
        )}`,
      );
      return null;
    }
  }

  private async getStashdbConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const integration = await this.getIntegration(IntegrationType.STASHDB);

    if (!integration.enabled) {
      throw new ConflictException('STASHDB integration is disabled.');
    }

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException('STASHDB integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new BadRequestException(
        'STASHDB integration is missing a base URL.',
      );
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }

  private async getIntegration(type: IntegrationType) {
    try {
      return await this.integrationsService.findOne(type);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ConflictException(
          `${type} integration has not been created yet.`,
        );
      }

      throw error;
    }
  }

  private safeJson(value: unknown): string {
    try {
      const serialized = JSON.stringify(value, null, 2);
      if (!serialized) {
        return 'null';
      }
      return serialized.length > 4000
        ? `${serialized.slice(0, 4000)}...(truncated)`
        : serialized;
    } catch {
      return '[unserializable]';
    }
  }

  private serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return {
      type: typeof error,
      value: error,
    };
  }
}
