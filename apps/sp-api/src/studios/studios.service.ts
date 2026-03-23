import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashdbSortDirection } from '../providers/stashdb/stashdb.adapter';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { StudioFeedResponseDto } from './dto/studio-feed-response.dto';
import { StudioSort } from './dto/studios-query.dto';

@Injectable()
export class StudiosService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 50;
  private static readonly DEFAULT_SORT: StudioSort = 'NAME';
  private static readonly DEFAULT_DIRECTION: StashdbSortDirection = 'ASC';

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly stashdbAdapter: StashdbAdapter,
  ) {}

  async getStudiosFeed(
    page = StudiosService.DEFAULT_PAGE,
    perPage = StudiosService.DEFAULT_PER_PAGE,
    filters?: {
      name?: string;
      sort?: StudioSort;
      direction?: StashdbSortDirection;
      favoritesOnly?: boolean;
    },
  ): Promise<StudioFeedResponseDto> {
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

    const studios = await this.stashdbAdapter.getStudiosFeed({
      baseUrl: integration.baseUrl,
      apiKey: integration.apiKey,
      page,
      perPage,
      name: filters?.name,
      sort: filters?.sort ?? StudiosService.DEFAULT_SORT,
      direction: filters?.direction ?? StudiosService.DEFAULT_DIRECTION,
      favoritesOnly: filters?.favoritesOnly === true,
    });

    const hasMore = page * perPage < studios.total;

    return {
      total: studios.total,
      page,
      perPage,
      hasMore,
      items: studios.studios.map((studio) => ({
        id: studio.id,
        name: studio.name,
        isFavorite: studio.isFavorite,
        imageUrl: studio.imageUrl,
        parentStudio: studio.parentStudio,
        childStudios: studio.childStudios,
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
