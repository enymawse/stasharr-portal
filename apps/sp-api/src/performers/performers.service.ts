import {
  DiscoverResponseDto,
} from '../discover/dto/discover-item.dto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { PerformerDetailsDto } from './dto/performer-details.dto';
import { PerformerFeedResponseDto } from './dto/performer-feed-response.dto';
import { PerformerScenesSort } from './dto/performer-scenes-query.dto';
import { PerformerStudioOptionDto } from './dto/performer-studio-option.dto';
import { PerformerGender, PerformerSort } from './dto/performers-query.dto';

@Injectable()
export class PerformersService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 50;
  private static readonly DEFAULT_SCENES_PER_PAGE = 25;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly sceneStatusService: SceneStatusService,
  ) {}

  async getPerformersFeed(
    page = PerformersService.DEFAULT_PAGE,
    perPage = PerformersService.DEFAULT_PER_PAGE,
    filters?: {
      name?: string;
      gender?: PerformerGender;
      sort?: PerformerSort;
      favoritesOnly?: boolean;
    },
  ): Promise<PerformerFeedResponseDto> {
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

    const performers = await this.stashdbAdapter.getPerformersFeed({
      baseUrl: integration.baseUrl,
      apiKey: integration.apiKey,
      page,
      perPage,
      name: filters?.name,
      gender: filters?.gender,
      sort: filters?.sort ?? 'NAME',
      favoritesOnly: filters?.favoritesOnly === true,
    });

    const hasMore = page * perPage < performers.total;

    return {
      total: performers.total,
      page,
      perPage,
      hasMore,
      items: performers.performers.map((performer) => ({
        id: performer.id,
        name: performer.name,
        gender: performer.gender,
        sceneCount: performer.sceneCount,
        isFavorite: performer.isFavorite,
        imageUrl: performer.imageUrl,
      })),
    };
  }

  async getPerformerById(performerId: string): Promise<PerformerDetailsDto> {
    const normalizedPerformerId = performerId.trim();
    if (!normalizedPerformerId) {
      throw new BadRequestException('Performer id is required.');
    }

    const config = await this.getStashdbConfig();
    const performer = await this.stashdbAdapter.getPerformerById(
      normalizedPerformerId,
      config,
    );

    return {
      id: performer.id,
      name: performer.name,
      disambiguation: performer.disambiguation,
      aliases: performer.aliases,
      gender: performer.gender,
      birthDate: performer.birthDate,
      deathDate: performer.deathDate,
      age: performer.age,
      ethnicity: performer.ethnicity,
      country: performer.country,
      eyeColor: performer.eyeColor,
      hairColor: performer.hairColor,
      height: performer.height,
      cupSize: performer.cupSize,
      bandSize: performer.bandSize,
      waistSize: performer.waistSize,
      hipSize: performer.hipSize,
      breastType: performer.breastType,
      careerStartYear: performer.careerStartYear,
      careerEndYear: performer.careerEndYear,
      deleted: performer.deleted,
      mergedIds: performer.mergedIds,
      mergedIntoId: performer.mergedIntoId,
      isFavorite: performer.isFavorite,
      createdAt: performer.createdAt,
      updatedAt: performer.updatedAt,
      imageUrl: performer.imageUrl,
      images: performer.images,
    };
  }

  async getPerformerScenes(
    performerId: string,
    page = PerformersService.DEFAULT_PAGE,
    perPage = PerformersService.DEFAULT_SCENES_PER_PAGE,
    filters?: {
      studioIds?: string[];
      tagIds?: string[];
      sort?: PerformerScenesSort;
      onlyFavoriteStudios?: boolean;
    },
  ): Promise<DiscoverResponseDto> {
    const normalizedPerformerId = performerId.trim();
    if (!normalizedPerformerId) {
      throw new BadRequestException('Performer id is required.');
    }

    const config = await this.getStashdbConfig();
    const scenes = await this.stashdbAdapter.getScenesForPerformer({
      ...config,
      performerId: normalizedPerformerId,
      page,
      perPage,
      sort: filters?.sort ?? 'DATE',
      studioIds: this.normalizeIds(filters?.studioIds ?? []),
      tagIds: this.normalizeIds(filters?.tagIds ?? []),
      onlyFavoriteStudios: filters?.onlyFavoriteStudios === true,
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
      items: scenes.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        description: scene.details,
        imageUrl: scene.imageUrl,
        studioId: scene.studioId,
        studio: scene.studioName,
        studioImageUrl: scene.studioImageUrl,
        releaseDate: scene.releaseDate ?? scene.productionDate ?? scene.date,
        duration: scene.duration,
        type: 'SCENE',
        source: 'STASHDB',
        status: statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' },
      })),
    };
  }

  async searchStudios(query?: string): Promise<PerformerStudioOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const config = await this.getStashdbConfig();
    return this.stashdbAdapter.searchStudios(normalizedQuery, config);
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

  private normalizeIds(ids: string[]): string[] {
    return [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
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
}
