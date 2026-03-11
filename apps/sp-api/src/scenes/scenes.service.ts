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
import { SceneDetailsDto } from './dto/scene-details.dto';

@Injectable()
export class ScenesService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly sceneStatusService: SceneStatusService,
  ) {}

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

    return {
      id: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      images: scene.images,
      studio: scene.studioName,
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      tags: scene.tags,
      performers: scene.performers,
      sourceUrls: scene.sourceUrls,
      source: 'STASHDB',
      status,
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
