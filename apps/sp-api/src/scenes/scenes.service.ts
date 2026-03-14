import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { DiscoverResponseDto } from '../discover/dto/discover-item.dto';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import {
  SceneDetailsDto,
  SceneStashAvailabilityDto,
  SceneWhisparrAvailabilityDto,
} from './dto/scene-details.dto';

@Injectable()
export class ScenesService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 25;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly sceneStatusService: SceneStatusService,
    private readonly stashAdapter: StashAdapter,
    private readonly whisparrAdapter: WhisparrAdapter,
  ) {}

  async getScenesFeed(
    page = ScenesService.DEFAULT_PAGE,
    perPage = ScenesService.DEFAULT_PER_PAGE,
  ): Promise<DiscoverResponseDto> {
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

    const scenes = await this.stashdbAdapter.getScenesSortedByDate({
      baseUrl: integration.baseUrl,
      apiKey: integration.apiKey,
      page,
      perPage,
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
        studio: scene.studioName,
        studioImageUrl: scene.studioImageUrl,
        releaseDate: scene.releaseDate ?? scene.productionDate ?? scene.date,
        duration: scene.duration,
        type: 'SCENE',
        source: 'STASHDB',
        status: statuses.get(scene.id) ?? { state: 'UNREQUESTED' },
      })),
    };
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
      studio: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      studioUrl: this.resolveStudioUrl(scene.sourceUrls),
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      tags: scene.tags,
      performers: scene.performers,
      sourceUrls: scene.sourceUrls,
      source: 'STASHDB',
      status,
      stash,
      whisparr,
    };
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

      const match = await this.whisparrAdapter.findSceneByStashId(stashId, {
        baseUrl,
        apiKey: integration.apiKey,
      });

      if (!match) {
        return null;
      }

      return {
        exists: true,
        viewUrl: this.whisparrAdapter.buildSceneViewUrl(baseUrl, stashId),
      };
    } catch {
      return null;
    }
  }
}
