import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LibrarySceneFeedItemDto,
  LibraryScenesFeedDto,
} from './dto/library-scenes-feed.dto';
import {
  LibrarySceneSort,
  LibrarySortDirection,
  LibraryTagMatchMode,
} from './dto/library-scenes-query.dto';

interface LibrarySceneQueryFilters {
  sort?: LibrarySceneSort;
  direction?: LibrarySortDirection;
  query?: string;
  tagIds?: string[];
  tagMode?: LibraryTagMatchMode;
  studioIds?: string[];
  favoritePerformersOnly?: boolean;
  favoriteStudiosOnly?: boolean;
  favoriteTagsOnly?: boolean;
}

@Injectable()
export class LibrarySceneQueryService {
  static readonly DEFAULT_PAGE = 1;
  static readonly DEFAULT_PER_PAGE = 24;
  static readonly DEFAULT_SORT: LibrarySceneSort = 'RELEASE_DATE';
  static readonly DEFAULT_DIRECTION: LibrarySortDirection = 'DESC';
  static readonly DEFAULT_TAG_MODE: LibraryTagMatchMode = 'OR';

  constructor(private readonly prisma: PrismaService) {}

  async getScenesFeed(
    page = LibrarySceneQueryService.DEFAULT_PAGE,
    perPage = LibrarySceneQueryService.DEFAULT_PER_PAGE,
    filters: LibrarySceneQueryFilters = {},
  ): Promise<LibraryScenesFeedDto> {
    const normalizedFilters = this.normalizeFilters(filters);
    const where = this.buildWhere(normalizedFilters);
    const orderBy = this.buildOrderBy(
      normalizedFilters.sort,
      normalizedFilters.direction,
    );
    const [rows, total] = await Promise.all([
      this.prisma.librarySceneIndex.findMany({
        where,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.librarySceneIndex.count({ where }),
    ]);

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: rows.map((row) => this.toSceneFeedItem(row)),
    };
  }

  async getScenesPreview(
    limit: number,
    filters: LibrarySceneQueryFilters = {},
  ): Promise<LibrarySceneFeedItemDto[]> {
    const normalizedFilters = this.normalizeFilters(filters);
    const rows = await this.prisma.librarySceneIndex.findMany({
      where: this.buildWhere(normalizedFilters),
      orderBy: this.buildOrderBy(
        normalizedFilters.sort,
        normalizedFilters.direction,
      ),
      take: limit,
    });

    return rows.map((row) => this.toSceneFeedItem(row));
  }

  private normalizeFilters(
    filters: LibrarySceneQueryFilters,
  ): Required<LibrarySceneQueryFilters> & { query: string } {
    return {
      sort: filters.sort ?? LibrarySceneQueryService.DEFAULT_SORT,
      direction:
        filters.direction ?? LibrarySceneQueryService.DEFAULT_DIRECTION,
      query: filters.query?.trim() ?? '',
      tagIds: this.normalizeIds(filters.tagIds ?? []),
      tagMode: filters.tagMode ?? LibrarySceneQueryService.DEFAULT_TAG_MODE,
      studioIds: this.normalizeIds(filters.studioIds ?? []),
      favoritePerformersOnly: filters.favoritePerformersOnly ?? false,
      favoriteStudiosOnly: filters.favoriteStudiosOnly ?? false,
      favoriteTagsOnly: filters.favoriteTagsOnly ?? false,
    };
  }

  private buildWhere(
    filters: Required<LibrarySceneQueryFilters> & { query: string },
  ): Prisma.LibrarySceneIndexWhereInput {
    const andClauses: Prisma.LibrarySceneIndexWhereInput[] = [];

    if (filters.query) {
      andClauses.push({
        OR: [
          {
            title: {
              contains: filters.query,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: filters.query,
              mode: 'insensitive',
            },
          },
          {
            studioName: {
              contains: filters.query,
              mode: 'insensitive',
            },
          },
        ],
      });
    }

    if (filters.tagIds.length > 0) {
      andClauses.push({
        tagIds:
          filters.tagMode === 'AND'
            ? {
                hasEvery: filters.tagIds,
              }
            : {
                hasSome: filters.tagIds,
              },
      });
    }

    if (filters.studioIds.length > 0) {
      andClauses.push({
        studioId: {
          in: filters.studioIds,
        },
      });
    }

    if (filters.favoritePerformersOnly) {
      andClauses.push({ hasFavoritePerformer: true });
    }

    if (filters.favoriteStudiosOnly) {
      andClauses.push({ favoriteStudio: true });
    }

    if (filters.favoriteTagsOnly) {
      andClauses.push({ hasFavoriteTag: true });
    }

    return andClauses.length > 0 ? { AND: andClauses } : {};
  }

  private buildOrderBy(
    sort: LibrarySceneSort,
    direction: LibrarySortDirection,
  ): Prisma.LibrarySceneIndexOrderByWithRelationInput[] {
    const order: Prisma.SortOrder = direction === 'ASC' ? 'asc' : 'desc';

    switch (sort) {
      case 'TITLE':
        return [{ title: order }, { stashSceneId: 'asc' }];
      case 'RELEASE_DATE':
        return [
          { releaseDate: order },
          { title: 'asc' },
          { stashSceneId: 'asc' },
        ];
      case 'CREATED_AT':
        return [
          { localCreatedAt: order },
          { title: 'asc' },
          { stashSceneId: 'asc' },
        ];
      case 'UPDATED_AT':
      default:
        return [
          { localUpdatedAt: order },
          { title: 'asc' },
          { stashSceneId: 'asc' },
        ];
    }
  }

  private toSceneFeedItem(
    row: Awaited<
      ReturnType<PrismaService['librarySceneIndex']['findMany']>
    >[number],
  ): LibrarySceneFeedItemDto {
    const screenshotUrl = row.imageUrl
      ? `/api/media/stash/scenes/${encodeURIComponent(row.stashSceneId)}/screenshot`
      : null;
    const studioLogoUrl =
      row.studioId && row.studioImageUrl
        ? `/api/media/stash/studios/${encodeURIComponent(row.studioId)}/logo`
        : null;

    return {
      id: row.stashSceneId,
      linkedStashId: row.linkedStashId,
      title: row.title,
      description: row.description,
      imageUrl: screenshotUrl,
      cardImageUrl: screenshotUrl,
      studioId: row.studioId,
      studio: row.studioName,
      studioImageUrl: studioLogoUrl,
      releaseDate: row.releaseDate,
      duration: row.duration,
      type: 'SCENE',
      source: 'STASH',
      viewUrl: row.viewUrl,
    };
  }

  private normalizeIds(values: string[]): string[] {
    return Array.from(
      new Set(
        values.map((value) => value.trim()).filter((value) => value.length > 0),
      ),
    );
  }
}
