import { BadRequestException, Injectable } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { type CatalogProviderKey } from '../providers/catalog/catalog-provider.util';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import {
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
  SortDirection,
  SceneTagMatchMode,
} from './dto/scenes-query.dto';

@Injectable()
export class ScenesService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly catalogProviderService: CatalogProviderService,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly sceneStatusService: SceneStatusService,
    private readonly stashAdapter: StashAdapter,
    private readonly whisparrAdapter: WhisparrAdapter,
  ) {}

  async getScenesFeed(
    page = ScenesService.DEFAULT_PAGE,
    perPage = ScenesService.DEFAULT_PER_PAGE,
    sort: SceneFeedSort = 'TRENDING',
    direction: SortDirection = 'DESC',
    tagIds: string[] = [],
    tagMode: SceneTagMatchMode = 'OR',
    favorites?: SceneFavoritesFilter,
    studioIds: string[] = [],
  ): Promise<ScenesFeedResponseDto> {
    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    const normalizedTagIds = this.normalizeTagIds(tagIds);
    const normalizedStudioIds = this.normalizeStudioIds(studioIds);
    const scenes = await this.stashdbAdapter.getScenesBySort({
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
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
    const statuses = await this.sceneStatusService.resolveForScenes(
      scenes.scenes.map((scene) => scene.id),
    );

    return {
      total: scenes.total,
      page,
      perPage,
      hasMore: page * perPage < scenes.total,
      items: scenes.scenes.map((scene) => {
        const status = statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' };
        return this.toScenesFeedItem(
          scene,
          catalogProvider.integrationType,
          status,
          isSceneStatusRequestable(status),
        );
      }),
    };
  }

  async searchSceneTags(query?: string): Promise<SceneTagOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();

    return this.stashdbAdapter.searchTags({
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
      query: normalizedQuery,
    });
  }

  async getSceneById(stashId: string): Promise<SceneDetailsDto> {
    const sceneId = stashId.trim();
    if (!sceneId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();

    const scene = await this.stashdbAdapter.getSceneById(sceneId, {
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
    });
    const status = await this.sceneStatusService.resolveForScene(scene.id);
    const stash = await this.resolveStashAvailability(
      scene.id,
      catalogProvider.providerKey,
    );
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
      source: catalogProvider.integrationType,
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

    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();
    return this.stashdbAdapter.favoriteStudio(
      normalizedStudioId,
      favorite,
      {
        baseUrl: catalogProvider.baseUrl,
        apiKey: catalogProvider.apiKey,
      },
    );
  }

  private async resolveStashAvailability(
    stashId: string,
    activeCatalogProviderKey: CatalogProviderKey | null,
  ): Promise<SceneStashAvailabilityDto | null> {
    try {
      if (!activeCatalogProviderKey) {
        return null;
      }

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

      const copies = await this.stashAdapter.findScenesByStashId(
        stashId,
        {
          baseUrl,
          apiKey: integration.apiKey,
        },
        {
          providerKey: activeCatalogProviderKey,
        },
      );

      return {
        exists: copies.length > 0,
        hasMultipleCopies: copies.length > 1,
        copies,
      };
    } catch {
      return null;
    }
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
    source: 'STASHDB' | 'FANSDB',
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
      source,
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
