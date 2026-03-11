import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { DiscoverItemDto } from './dto/discover-item.dto';

@Injectable()
export class DiscoverService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashdbAdapter: StashdbAdapter,
  ) {}

  async getDiscoverFeed(): Promise<DiscoverItemDto[]> {
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

    const trendingScenes = await this.stashdbAdapter.getTrendingScenes({
      baseUrl: integration.baseUrl,
      apiKey: integration.apiKey,
    });

    return trendingScenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      type: 'SCENE',
      imageUrl: scene.imageUrl,
      studio: scene.studio,
      releaseDate: scene.releaseDate,
      source: 'STASHDB',
      sourceUrl: scene.sourceUrl,
    }));
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
