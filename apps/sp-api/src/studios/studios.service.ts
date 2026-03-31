import { BadRequestException, Injectable } from '@nestjs/common';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbSortDirection } from '../providers/stashdb/stashdb.adapter';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { StudioDetailsDto } from './dto/studio-details.dto';
import { StudioFeedResponseDto } from './dto/studio-feed-response.dto';
import { StudioSort } from './dto/studios-query.dto';

@Injectable()
export class StudiosService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;
  private static readonly DEFAULT_SORT: StudioSort = 'NAME';
  private static readonly DEFAULT_DIRECTION: StashdbSortDirection = 'ASC';

  constructor(
    private readonly catalogProviderService: CatalogProviderService,
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
    const config = await this.getActiveCatalogConfig();

    const studios = await this.stashdbAdapter.getStudiosFeed({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
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

  async getStudioById(studioId: string): Promise<StudioDetailsDto> {
    const normalizedStudioId = studioId.trim();
    if (!normalizedStudioId) {
      throw new BadRequestException('Studio id is required.');
    }

    const config = await this.getActiveCatalogConfig();
    const studio = await this.stashdbAdapter.getStudioById(
      normalizedStudioId,
      config,
    );

    return {
      id: studio.id,
      name: studio.name,
      aliases: studio.aliases,
      deleted: studio.deleted,
      isFavorite: studio.isFavorite,
      createdAt: studio.createdAt,
      updatedAt: studio.updatedAt,
      imageUrl: studio.imageUrl,
      images: studio.images,
      urls: studio.urls,
      parentStudio: studio.parentStudio,
      childStudios: studio.childStudios,
    };
  }

  private async getActiveCatalogConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const catalogProvider =
      await this.catalogProviderService.getActiveCatalogProvider();

    return {
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
    };
  }
}
