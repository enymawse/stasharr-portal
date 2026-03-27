import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { HybridScenesService } from '../hybrid-scenes/hybrid-scenes.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { StashdbScene } from '../providers/stashdb/stashdb.adapter';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import {
  SceneStatus,
  SceneStatusDto,
  isSceneStatusRequestable,
} from '../scene-status/dto/scene-status.dto';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { SceneTagOptionDto } from './dto/scene-tag-option.dto';
import {
  SceneDetailsDto,
  SceneStashAvailabilityDto,
  SceneWhisparrAvailabilityDto,
} from './dto/scene-details.dto';
import { ScenesFeedResponseDto } from './dto/scenes-feed.dto';
import {
  SceneFavoritesFilter,
  SceneFeedSort,
  SceneLifecycleFilter,
  SceneLibraryAvailability,
  SortDirection,
  SceneTagMatchMode,
} from './dto/scenes-query.dto';

@Injectable()
export class ScenesService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 25;
  private static readonly LIFECYCLE_SCAN_PAGE_SIZE = 50;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly sceneStatusService: SceneStatusService,
    private readonly stashAdapter: StashAdapter,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly hybridScenesService: HybridScenesService,
  ) {}

  async getScenesFeed(
    page = ScenesService.DEFAULT_PAGE,
    perPage = ScenesService.DEFAULT_PER_PAGE,
    sort: SceneFeedSort = 'DATE',
    direction: SortDirection = 'DESC',
    tagIds: string[] = [],
    tagMode: SceneTagMatchMode = 'OR',
    favorites?: SceneFavoritesFilter,
    studioIds: string[] = [],
    libraryAvailability: SceneLibraryAvailability = 'ANY',
    lifecycle: SceneLifecycleFilter = 'ANY',
    stashFavoritePerformersOnly = false,
    stashFavoriteStudiosOnly = false,
    stashFavoriteTagsOnly = false,
  ): Promise<ScenesFeedResponseDto> {
    const stashdbConfig = await this.getStashdbConfig();
    const normalizedTagIds = this.normalizeTagIds(tagIds);
    const normalizedStudioIds = this.normalizeStudioIds(studioIds);
    const hybridActive =
      libraryAvailability !== 'ANY' ||
      stashFavoritePerformersOnly ||
      stashFavoriteStudiosOnly ||
      stashFavoriteTagsOnly;
    const lifecycleFilter = lifecycle === 'ANY' ? null : lifecycle;

    if (lifecycleFilter) {
      return this.getLifecycleFilteredScenesFeed({
        stashdbConfig,
        stashConfig: hybridActive ? await this.getStashConfig() : null,
        page,
        perPage,
        sort,
        direction,
        favorites,
        tagIds: normalizedTagIds,
        tagMode,
        studioIds: normalizedStudioIds,
        libraryAvailability,
        lifecycleFilter,
        stashFavoritePerformersOnly,
        stashFavoriteStudiosOnly,
        stashFavoriteTagsOnly,
        hybridActive,
      });
    }

    if (!hybridActive) {
      const scenes = await this.stashdbAdapter.getScenesBySort({
        ...stashdbConfig,
        page,
        perPage,
        sort,
        direction,
        favorites,
        studioIds: normalizedStudioIds,
        tagFilter:
          normalizedTagIds.length > 0
            ? {
                tagIds: normalizedTagIds,
                mode: tagMode,
              }
            : undefined,
      });

      const hasMore = page * perPage < scenes.total;
      const statuses = await this.sceneStatusService.resolveForScenes(
        scenes.scenes.map((scene) => scene.id),
      );

      return {
        total: scenes.total,
        page,
        perPage,
        hasMore,
        items: scenes.scenes.map((scene) => {
          const status = statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' };
          return this.toScenesFeedItem(
            scene,
            status,
            isSceneStatusRequestable(status),
          );
        }),
      };
    }

    const stashConfig = await this.getStashConfig();
    const hybridFeed = await this.hybridScenesService.getHybridSceneFeed(
      stashdbConfig,
      stashConfig,
      {
        page,
        perPage,
        sort,
        direction,
        stashdbFavorites: favorites,
        tagIds: normalizedTagIds,
        tagMode,
        studioIds: normalizedStudioIds,
        libraryAvailability,
        stashFavoritePerformersOnly,
        stashFavoriteStudiosOnly,
        stashFavoriteTagsOnly,
      },
    );

    const isInLibraryAvailability =
      hybridFeed.effectiveAvailability === 'IN_LIBRARY';
    const statuses = isInLibraryAvailability
      ? new Map<string, { state: 'AVAILABLE' }>()
      : await this.sceneStatusService.resolveForScenes(
          hybridFeed.scenes.map((scene) => scene.id),
        );

    return {
      total: hybridFeed.total,
      page,
      perPage,
      hasMore: hybridFeed.hasMore,
      items: hybridFeed.scenes.map((scene) =>
        this.toScenesFeedItem(
          scene,
          isInLibraryAvailability
            ? { state: 'AVAILABLE' }
            : (statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' }),
          !isInLibraryAvailability &&
            isSceneStatusRequestable(
              statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' },
            ),
        ),
      ),
    };
  }

  private async getLifecycleFilteredScenesFeed(config: {
    stashdbConfig: { baseUrl: string; apiKey: string | null };
    stashConfig: { baseUrl: string; apiKey: string | null } | null;
    page: number;
    perPage: number;
    sort: SceneFeedSort;
    direction: SortDirection;
    favorites?: SceneFavoritesFilter;
    tagIds: string[];
    tagMode: SceneTagMatchMode;
    studioIds: string[];
    libraryAvailability: SceneLibraryAvailability;
    lifecycleFilter: SceneStatus;
    stashFavoritePerformersOnly: boolean;
    stashFavoriteStudiosOnly: boolean;
    stashFavoriteTagsOnly: boolean;
    hybridActive: boolean;
  }): Promise<ScenesFeedResponseDto> {
    const startIndex = Math.max(0, (config.page - 1) * config.perPage);
    const targetMatchCount = startIndex + config.perPage + 1;
    const batchSize = Math.max(
      config.perPage,
      ScenesService.LIFECYCLE_SCAN_PAGE_SIZE,
    );
    const matched: Array<{ scene: StashdbScene; status: SceneStatusDto }> = [];
    let candidatePage = 1;
    let hasMoreCandidates = true;

    while (hasMoreCandidates && matched.length < targetMatchCount) {
      const batchResult = await this.fetchLifecycleCandidateBatch(
        config,
        candidatePage,
        batchSize,
      );
      hasMoreCandidates = batchResult.hasMore;
      candidatePage += 1;

      if (batchResult.scenes.length === 0) {
        break;
      }

      const statuses = batchResult.forcedAvailable
        ? new Map<string, SceneStatusDto>(
            batchResult.scenes.map((scene) => [
              scene.id,
              { state: 'AVAILABLE' as const },
            ]),
          )
        : await this.sceneStatusService.resolveForScenes(
            batchResult.scenes.map((scene) => scene.id),
          );

      for (const scene of batchResult.scenes) {
        const status: SceneStatusDto = batchResult.forcedAvailable
          ? { state: 'AVAILABLE' }
          : (statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' });
        if (status.state === config.lifecycleFilter) {
          matched.push({ scene, status });
          if (matched.length >= targetMatchCount) {
            break;
          }
        }
      }
    }

    const pageMatches = matched.slice(startIndex, startIndex + config.perPage);
    return {
      total: null,
      page: config.page,
      perPage: config.perPage,
      hasMore: matched.length > startIndex + config.perPage,
      items: pageMatches.map(({ scene, status }) =>
        this.toScenesFeedItem(scene, status, isSceneStatusRequestable(status)),
      ),
    };
  }

  private async fetchLifecycleCandidateBatch(
    config: {
      stashdbConfig: { baseUrl: string; apiKey: string | null };
      stashConfig: { baseUrl: string; apiKey: string | null } | null;
      sort: SceneFeedSort;
      direction: SortDirection;
      favorites?: SceneFavoritesFilter;
      tagIds: string[];
      tagMode: SceneTagMatchMode;
      studioIds: string[];
      libraryAvailability: SceneLibraryAvailability;
      stashFavoritePerformersOnly: boolean;
      stashFavoriteStudiosOnly: boolean;
      stashFavoriteTagsOnly: boolean;
      hybridActive: boolean;
    },
    page: number,
    perPage: number,
  ): Promise<{
    scenes: StashdbScene[];
    hasMore: boolean;
    forcedAvailable: boolean;
  }> {
    if (!config.hybridActive) {
      const scenes = await this.stashdbAdapter.getScenesBySort({
        ...config.stashdbConfig,
        page,
        perPage,
        sort: config.sort,
        direction: config.direction,
        favorites: config.favorites,
        studioIds: config.studioIds,
        tagFilter:
          config.tagIds.length > 0
            ? {
                tagIds: config.tagIds,
                mode: config.tagMode,
              }
            : undefined,
      });

      return {
        scenes: scenes.scenes,
        hasMore: page * perPage < scenes.total,
        forcedAvailable: false,
      };
    }

    if (!config.stashConfig) {
      return { scenes: [], hasMore: false, forcedAvailable: false };
    }

    const hybridFeed = await this.hybridScenesService.getHybridSceneFeed(
      config.stashdbConfig,
      config.stashConfig,
      {
        page,
        perPage,
        sort: config.sort,
        direction: config.direction,
        stashdbFavorites: config.favorites,
        tagIds: config.tagIds,
        tagMode: config.tagMode,
        studioIds: config.studioIds,
        libraryAvailability: config.libraryAvailability,
        stashFavoritePerformersOnly: config.stashFavoritePerformersOnly,
        stashFavoriteStudiosOnly: config.stashFavoriteStudiosOnly,
        stashFavoriteTagsOnly: config.stashFavoriteTagsOnly,
      },
    );

    return {
      scenes: hybridFeed.scenes,
      hasMore: hybridFeed.hasMore,
      forcedAvailable: hybridFeed.effectiveAvailability === 'IN_LIBRARY',
    };
  }

  async searchSceneTags(query?: string): Promise<SceneTagOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const integration = await this.getStashdbIntegration();

    if (!integration.enabled) {
      throw new ConflictException('STASHDB integration is disabled.');
    }

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException('STASHDB integration is not configured.');
    }

    if (!integration.baseUrl) {
      throw new BadRequestException(
        'STASHDB integration is missing a base URL.',
      );
    }

    return this.stashdbAdapter.searchTags({
      baseUrl: integration.baseUrl,
      apiKey: integration.apiKey,
      query: normalizedQuery,
    });
  }

  async getSceneById(stashId: string): Promise<SceneDetailsDto> {
    const sceneId = stashId.trim();
    if (!sceneId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const integration = await this.getStashdbIntegration();

    if (!integration.enabled) {
      throw new ConflictException('STASHDB integration is disabled.');
    }

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException('STASHDB integration is not configured.');
    }

    if (!integration.baseUrl) {
      throw new BadRequestException(
        'STASHDB integration is missing a base URL.',
      );
    }

    const scene = await this.stashdbAdapter.getSceneById(sceneId, {
      baseUrl: integration.baseUrl,
      apiKey: integration.apiKey,
    });
    const status = await this.sceneStatusService.resolveForScene(scene.id);
    const stash = await this.resolveStashAvailability(scene.id);
    const whisparr = await this.resolveWhisparrAvailability(scene.id);

    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      images: scene.images,
      studioId: scene.studioId,
      studioIsFavorite: scene.studioIsFavorite,
      studio: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      studioUrl: this.resolveStudioUrl(scene.sourceUrls),
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      tags: scene.tags,
      performers: scene.performers.map((performer) => ({
        ...performer,
        cardImageUrl: withStashImageSize(performer.imageUrl, 300),
      })),
      sourceUrls: scene.sourceUrls,
      source: 'STASHDB',
      status,
      stash,
      whisparr,
    };
  }

  async favoriteStudio(
    studioId: string,
    favorite: boolean,
  ): Promise<{ favorited: boolean; alreadyFavorited: boolean }> {
    const normalizedStudioId = studioId.trim();
    if (!normalizedStudioId) {
      throw new BadRequestException('Studio id is required.');
    }

    const config = await this.getStashdbConfig();
    return this.stashdbAdapter.favoriteStudio(
      normalizedStudioId,
      favorite,
      config,
    );
  }

  private async resolveStashAvailability(
    stashId: string,
  ): Promise<SceneStashAvailabilityDto | null> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.STASH,
      );

      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      const copies = await this.stashAdapter.findScenesByStashId(stashId, {
        baseUrl,
        apiKey: integration.apiKey,
      });

      return {
        exists: copies.length > 0,
        hasMultipleCopies: copies.length > 1,
        copies,
      };
    } catch {
      return null;
    }
  }

  private async getStashdbIntegration() {
    try {
      return await this.integrationsService.findOne(IntegrationType.STASHDB);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ConflictException(
          'STASHDB integration has not been created yet.',
        );
      }

      throw error;
    }
  }

  private async getStashdbConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const integration = await this.getStashdbIntegration();

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

  private async getStashConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const integration = await this.integrationsService.findOne(
      IntegrationType.STASH,
    );

    if (!integration.enabled) {
      throw new ConflictException('STASH integration is disabled.');
    }

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException('STASH integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new BadRequestException('STASH integration is missing a base URL.');
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }

  private toScenesFeedItem(
    scene: {
      id: string;
      title: string;
      details: string | null;
      imageUrl: string | null;
      studioId: string | null;
      studioName: string | null;
      studioImageUrl: string | null;
      releaseDate: string | null;
      productionDate: string | null;
      date: string | null;
      duration: number | null;
    },
    status: SceneStatusDto,
    requestable: boolean,
  ) {
    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      cardImageUrl: withStashImageSize(scene.imageUrl, 600),
      studioId: scene.studioId,
      studio: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      releaseDate: scene.releaseDate ?? scene.productionDate ?? scene.date,
      duration: scene.duration,
      type: 'SCENE' as const,
      source: 'STASHDB' as const,
      status,
      requestable,
    };
  }

  private normalizeTagIds(tagIds: string[]): string[] {
    return [...new Set(tagIds.map((tagId) => tagId.trim()).filter(Boolean))];
  }

  private normalizeStudioIds(studioIds: string[]): string[] {
    return [
      ...new Set(studioIds.map((studioId) => studioId.trim()).filter(Boolean)),
    ];
  }

  private resolveStudioUrl(
    sourceUrls: Array<{ url: string; type: string | null }>,
  ): string | null {
    const studioEntry = sourceUrls.find((entry) => {
      const normalizedType = entry.type?.trim().toLowerCase() ?? '';
      return normalizedType.includes('studio');
    });

    return studioEntry?.url ?? null;
  }

  private async resolveWhisparrAvailability(
    stashId: string,
  ): Promise<SceneWhisparrAvailabilityDto | null> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.WHISPARR,
      );

      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      const movie = await this.whisparrAdapter.findMovieByStashId(stashId, {
        baseUrl,
        apiKey: integration.apiKey,
      });

      if (!movie) {
        return null;
      }

      return {
        exists: true,
        viewUrl: this.whisparrAdapter.buildSceneViewUrl(baseUrl, movie.movieId),
      };
    } catch {
      return null;
    }
  }
}
