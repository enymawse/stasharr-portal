import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { PerformerFeedResponseDto } from './dto/performer-feed-response.dto';
import { PerformerGender, PerformerSort } from './dto/performers-query.dto';

@Injectable()
export class PerformersService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 50;

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashdbAdapter: StashdbAdapter,
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
