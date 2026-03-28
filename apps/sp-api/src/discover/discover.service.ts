import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { DiscoverResponseDto } from './dto/discover-item.dto';

@Injectable()
export class DiscoverService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly sceneStatusService: SceneStatusService,
  ) {}

  async getDiscoverFeed(
    page = DiscoverService.DEFAULT_PAGE,
    perPage = DiscoverService.DEFAULT_PER_PAGE,
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

    const trending = await this.stashdbAdapter.getTrendingScenes({
      baseUrl: integration.baseUrl,
      apiKey: integration.apiKey,
      page,
      perPage,
    });

    const hasMore = page * perPage < trending.total;
    const statuses = await this.sceneStatusService.resolveForScenes(
      trending.scenes.map((scene) => scene.id),
    );

    return {
      total: trending.total,
      page,
      perPage,
      hasMore,
      items: trending.scenes.map((scene) => ({
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
        type: 'SCENE',
        source: 'STASHDB',
        status: statuses.get(scene.id) ?? { state: 'NOT_REQUESTED' },
      })),
    };
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
