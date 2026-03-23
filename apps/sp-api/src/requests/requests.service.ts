import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  RequestStatus,
} from '@prisma/client';
import {
  DiscoverItemDto,
  DiscoverResponseDto,
} from '../discover/dto/discover-item.dto';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  StashdbAdapter,
  StashdbSceneDetails,
} from '../providers/stashdb/stashdb.adapter';
import {
  WhisparrAdapter,
  WhisparrAdapterBaseConfig,
} from '../providers/whisparr/whisparr.adapter';
import { SceneStatusDto } from '../scene-status/dto/scene-status.dto';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { RequestOptionsDto } from './dto/request-options.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene-request.dto';
import { SubmitSceneRequestResponseDto } from './dto/submit-scene-request-response.dto';

@Injectable()
export class RequestsService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 25;
  private static readonly LOOKUP_BATCH_SIZE = 8;

  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly sceneStatusService: SceneStatusService,
    private readonly prisma: PrismaService,
  ) {}

  async getRequestsFeed(
    page = RequestsService.DEFAULT_PAGE,
    perPage = RequestsService.DEFAULT_PER_PAGE,
  ): Promise<DiscoverResponseDto> {
    const whisparrConfig = await this.getWhisparrConfig();
    const stashdbConfig = await this.getStashdbConfig();

    const queueSnapshot = await this.whisparrAdapter.getQueueSnapshot(
      whisparrConfig,
    );
    const uniqueMovieIds = this.getUniqueMovieIds(queueSnapshot);

    this.logger.debug(
      `Requests queue snapshot summary: ${this.safeJson({
        queueCount: queueSnapshot.length,
        uniqueMovieIdCount: uniqueMovieIds.length,
        sampleMovieIds: uniqueMovieIds.slice(0, 10),
      })}`,
    );

    const stashIds = await this.resolveStashIdsForQueueMovieIds(
      uniqueMovieIds,
      whisparrConfig,
    );

    const total = stashIds.length;
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const pageStashIds = stashIds.slice(start, end);
    const hasMore = page * perPage < total;

    if (pageStashIds.length === 0) {
      return {
        total,
        page,
        perPage,
        hasMore,
        items: [],
      };
    }

    const statuses = await this.sceneStatusService.resolveForScenes(pageStashIds);
    const items = await this.enrichSceneCards(pageStashIds, stashdbConfig, statuses);

    return {
      total,
      page,
      perPage,
      hasMore,
      items,
    };
  }

  async getRequestOptions(stashId: string): Promise<RequestOptionsDto> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const whisparrConfig = await this.getWhisparrConfig();
    const stashdbConfig = await this.getStashdbConfig();

    const scene = await this.stashdbAdapter.getSceneById(
      normalizedStashId,
      stashdbConfig,
    );

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.whisparrAdapter.getRootFolders(whisparrConfig),
      this.whisparrAdapter.getQualityProfiles(whisparrConfig),
      this.whisparrAdapter.getTags(whisparrConfig),
    ]);

    if (rootFolders.filter((folder) => folder.accessible).length === 0) {
      throw new ConflictException(
        'No accessible Whisparr root folders are available.',
      );
    }

    if (qualityProfiles.length === 0) {
      throw new ConflictException('No Whisparr quality profiles are available.');
    }

    return {
      scene: {
        stashId: scene.id,
        title: scene.title,
        studio: scene.studioName,
      },
      defaults: {
        monitored: true,
        searchForMovie: true,
      },
      rootFolders,
      qualityProfiles,
      tags,
    };
  }

  async submitSceneRequest(
    stashId: string,
    dto: SubmitSceneRequestDto,
  ): Promise<SubmitSceneRequestResponseDto> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const whisparrConfig = await this.getWhisparrConfig();
    const stashdbConfig = await this.getStashdbConfig();

    const scene = await this.stashdbAdapter.getSceneById(
      normalizedStashId,
      stashdbConfig,
    );
    const title = scene.title.trim();
    const studio = scene.studioName?.trim() ?? '';

    if (!title) {
      throw new ConflictException(
        'Scene metadata is missing a title required for Whisparr submission.',
      );
    }

    if (!studio) {
      throw new ConflictException(
        'Scene metadata is missing a studio required for Whisparr submission.',
      );
    }

    const existingMovie = await this.whisparrAdapter.findMovieByStashId(
      normalizedStashId,
      whisparrConfig,
    );
    if (existingMovie) {
      await this.upsertLocalRequestRow(normalizedStashId);
      return {
        accepted: true,
        alreadyExists: true,
        stashId: normalizedStashId,
        whisparrMovieId: existingMovie.movieId,
      };
    }

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.whisparrAdapter.getRootFolders(whisparrConfig),
      this.whisparrAdapter.getQualityProfiles(whisparrConfig),
      this.whisparrAdapter.getTags(whisparrConfig),
    ]);

    if (rootFolders.filter((folder) => folder.accessible).length === 0) {
      throw new ConflictException(
        'No accessible Whisparr root folders are available.',
      );
    }

    if (qualityProfiles.length === 0) {
      throw new ConflictException('No Whisparr quality profiles are available.');
    }

    const selectedRootFolder = rootFolders.find(
      (folder) => folder.path === dto.rootFolderPath,
    );
    if (!selectedRootFolder) {
      throw new BadRequestException(
        'Selected root folder does not exist in Whisparr.',
      );
    }
    if (!selectedRootFolder.accessible) {
      throw new BadRequestException(
        'Selected root folder is not accessible in Whisparr.',
      );
    }

    const selectedQualityProfile = qualityProfiles.find(
      (profile) => profile.id === dto.qualityProfileId,
    );
    if (!selectedQualityProfile) {
      throw new BadRequestException(
        'Selected quality profile does not exist in Whisparr.',
      );
    }

    const allowedTagIds = new Set(tags.map((tag) => tag.id));
    for (const tagId of dto.tags) {
      if (!allowedTagIds.has(tagId)) {
        throw new BadRequestException(
          `Selected tag id ${tagId} does not exist in Whisparr.`,
        );
      }
    }

    const createdMovie = await this.whisparrAdapter.createMovie(
      {
        title,
        studio,
        foreignId: normalizedStashId,
        monitored: dto.monitored,
        rootFolderPath: dto.rootFolderPath,
        addOptions: {
          searchForMovie: dto.searchForMovie,
        },
        qualityProfileId: dto.qualityProfileId,
        tags: dto.tags,
      },
      whisparrConfig,
    );

    await this.upsertLocalRequestRow(normalizedStashId);

    return {
      accepted: true,
      alreadyExists: false,
      stashId: normalizedStashId,
      whisparrMovieId: createdMovie.movieId ?? null,
    };
  }

  private async upsertLocalRequestRow(stashId: string): Promise<void> {
    await this.prisma.request.upsert({
      where: { stashId },
      create: {
        stashId,
        status: RequestStatus.REQUESTED,
      },
      update: {
        status: RequestStatus.REQUESTED,
      },
    });
  }

  private async resolveStashIdsForQueueMovieIds(
    movieIds: number[],
    config: WhisparrAdapterBaseConfig,
  ): Promise<string[]> {
    const orderedStashIds: string[] = [];
    const seenStashIds = new Set<string>();

    for (
      let i = 0;
      i < movieIds.length;
      i += RequestsService.LOOKUP_BATCH_SIZE
    ) {
      const batch = movieIds.slice(i, i + RequestsService.LOOKUP_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (movieId) => {
          try {
            return await this.whisparrAdapter.findMovieById(movieId, config);
          } catch (error) {
            this.logger.warn(
              `Skipping queue movieId due to lookup failure: ${this.safeJson({
                movieId,
                error: this.serializeError(error),
              })}`,
            );
            return null;
          }
        }),
      );

      for (let index = 0; index < batch.length; index += 1) {
        const movieId = batch[index];
        const movie = results[index] ?? null;

        if (!movie) {
          this.logger.warn(
            `Skipping queue movieId with no movie mapping: ${movieId}`,
          );
          continue;
        }

        const queueStashId = movie.stashId.trim();
        if (!queueStashId) {
          this.logger.warn(
            `Skipping queue movieId with empty stashId mapping: ${movieId}`,
          );
          continue;
        }

        if (seenStashIds.has(queueStashId)) {
          continue;
        }

        seenStashIds.add(queueStashId);
        orderedStashIds.push(queueStashId);
      }
    }

    return orderedStashIds;
  }

  private async enrichSceneCards(
    stashIds: string[],
    stashdbConfig: { baseUrl: string; apiKey: string | null },
    statuses: Map<string, SceneStatusDto>,
  ): Promise<DiscoverItemDto[]> {
    const items = await Promise.all(
      stashIds.map(async (stashId) => {
        try {
          const scene = await this.stashdbAdapter.getSceneById(
            stashId,
            stashdbConfig,
          );
          return this.mapSceneToCard(scene, statuses.get(stashId));
        } catch (error) {
          this.logger.warn(
            `Skipping queue stashId due to enrichment failure: ${this.safeJson({
              stashId,
              error: this.serializeError(error),
            })}`,
          );
          return null;
        }
      }),
    );

    return items.filter((item): item is DiscoverItemDto => item !== null);
  }

  private mapSceneToCard(
    scene: StashdbSceneDetails,
    status: SceneStatusDto | undefined,
  ): DiscoverItemDto {
    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      studioId: scene.studioId,
      studio: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      type: 'SCENE',
      source: 'STASHDB',
      status: status ?? { state: 'NOT_REQUESTED' },
    };
  }

  private getUniqueMovieIds(queueSnapshot: Array<{ movieId: number }>): number[] {
    const seen = new Set<number>();
    const ordered: number[] = [];

    for (const item of queueSnapshot) {
      if (seen.has(item.movieId)) {
        continue;
      }
      seen.add(item.movieId);
      ordered.push(item.movieId);
    }

    return ordered;
  }

  private async getWhisparrConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const integration = await this.getIntegration(IntegrationType.WHISPARR);

    if (!integration.enabled) {
      throw new ConflictException('WHISPARR integration is disabled.');
    }

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException('WHISPARR integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new BadRequestException(
        'WHISPARR integration is missing a base URL.',
      );
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
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
      throw new BadRequestException('STASHDB integration is missing a base URL.');
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
