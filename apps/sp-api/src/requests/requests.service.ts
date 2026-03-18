import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import {
  DiscoverItemDto,
  DiscoverResponseDto,
} from '../discover/dto/discover-item.dto';
import {
  StashdbAdapter,
  StashdbSceneDetails,
} from '../providers/stashdb/stashdb.adapter';
import {
  WhisparrAdapter,
  WhisparrAdapterBaseConfig,
} from '../providers/whisparr/whisparr.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { IntegrationsService } from '../integrations/integrations.service';

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

    this.logger.debug(
      `Requests feed page built: ${this.safeJson({
        page,
        perPage,
        total,
        hasMore,
        requestedIds: pageStashIds,
        returnedItems: items.length,
      })}`,
    );

    return {
      total,
      page,
      perPage,
      hasMore,
      items,
    };
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
          this.logger.warn(`Skipping queue movieId with no movie mapping: ${movieId}`);
          continue;
        }

        const stashId = movie.stashId.trim();
        if (!stashId) {
          this.logger.warn(
            `Skipping queue movieId with empty stashId mapping: ${movieId}`,
          );
          continue;
        }

        if (seenStashIds.has(stashId)) {
          continue;
        }

        seenStashIds.add(stashId);
        orderedStashIds.push(stashId);
      }
    }

    return orderedStashIds;
  }

  private async enrichSceneCards(
    stashIds: string[],
    stashdbConfig: { baseUrl: string; apiKey: string | null },
    statuses: Map<string, { state: 'NOT_REQUESTED' | 'DOWNLOADING' | 'AVAILABLE' | 'MISSING' }>,
  ): Promise<DiscoverItemDto[]> {
    const items = await Promise.all(
      stashIds.map(async (stashId) => {
        try {
          const scene = await this.stashdbAdapter.getSceneById(stashId, stashdbConfig);
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
    status: { state: 'NOT_REQUESTED' | 'DOWNLOADING' | 'AVAILABLE' | 'MISSING' } | undefined,
  ): DiscoverItemDto {
    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
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

  private async getWhisparrConfig(): Promise<{ baseUrl: string; apiKey: string | null }> {
    const integration = await this.getIntegration(IntegrationType.WHISPARR);

    if (!integration.enabled) {
      throw new ConflictException('WHISPARR integration is disabled.');
    }

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException('WHISPARR integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new BadRequestException('WHISPARR integration is missing a base URL.');
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }

  private async getStashdbConfig(): Promise<{ baseUrl: string; apiKey: string | null }> {
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
        throw new ConflictException(`${type} integration has not been created yet.`);
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
