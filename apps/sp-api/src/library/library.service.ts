import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LibraryScenesFeedDto, LibrarySceneFeedItemDto } from './dto/library-scenes-feed.dto';
import {
  LibrarySceneSort,
  LibrarySortDirection,
  LibraryTagMatchMode,
} from './dto/library-scenes-query.dto';
import { LibraryStudioOptionDto } from './dto/library-studio-option.dto';
import { LibraryTagOptionDto } from './dto/library-tag-option.dto';

@Injectable()
export class LibraryService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 24;

  constructor(private readonly prisma: PrismaService) {}

  async getScenesFeed(
    page = LibraryService.DEFAULT_PAGE,
    perPage = LibraryService.DEFAULT_PER_PAGE,
    sort: LibrarySceneSort = 'RELEASE_DATE',
    direction: LibrarySortDirection = 'DESC',
    query?: string,
    tagIds: string[] = [],
    tagMode: LibraryTagMatchMode = 'OR',
    studioIds: string[] = [],
  ): Promise<LibraryScenesFeedDto> {
    const normalizedQuery = query?.trim() ?? '';
    const normalizedTagIds = this.normalizeIds(tagIds);
    const normalizedStudioIds = this.normalizeIds(studioIds);
    const where = this.buildWhere(
      normalizedQuery,
      normalizedTagIds,
      tagMode,
      normalizedStudioIds,
    );
    const orderBy = this.buildOrderBy(sort, direction);
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

  async searchTags(query?: string): Promise<LibraryTagOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    return this.prisma.$queryRaw<LibraryTagOptionDto[]>(Prisma.sql`
      SELECT DISTINCT tag_id AS id, tag_name AS name
      FROM "LibrarySceneIndex",
        unnest("tagIds", "tagNames") AS tag(tag_id, tag_name)
      WHERE tag_name ILIKE ${`%${normalizedQuery}%`}
      ORDER BY tag_name ASC
      LIMIT 25
    `);
  }

  async searchStudios(query?: string): Promise<LibraryStudioOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    return this.prisma.$queryRaw<LibraryStudioOptionDto[]>(Prisma.sql`
      SELECT DISTINCT "studioId" AS id, "studioName" AS name
      FROM "LibrarySceneIndex"
      WHERE "studioId" IS NOT NULL
        AND "studioName" IS NOT NULL
        AND "studioName" ILIKE ${`%${normalizedQuery}%`}
      ORDER BY "studioName" ASC
      LIMIT 25
    `);
  }

  private buildWhere(
    query: string,
    tagIds: string[],
    tagMode: LibraryTagMatchMode,
    studioIds: string[],
  ): Prisma.LibrarySceneIndexWhereInput {
    const andClauses: Prisma.LibrarySceneIndexWhereInput[] = [];

    if (query) {
      andClauses.push({
        OR: [
          {
            title: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            description: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            studioName: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
      });
    }

    if (tagIds.length > 0) {
      andClauses.push({
        tagIds:
          tagMode === 'AND'
            ? {
                hasEvery: tagIds,
              }
            : {
                hasSome: tagIds,
              },
      });
    }

    if (studioIds.length > 0) {
      andClauses.push({
        studioId: {
          in: studioIds,
        },
      });
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
        return [{ releaseDate: order }, { title: 'asc' }, { stashSceneId: 'asc' }];
      case 'CREATED_AT':
        return [{ localCreatedAt: order }, { title: 'asc' }, { stashSceneId: 'asc' }];
      case 'UPDATED_AT':
      default:
        return [{ localUpdatedAt: order }, { title: 'asc' }, { stashSceneId: 'asc' }];
    }
  }

  private toSceneFeedItem(
    row: Awaited<ReturnType<PrismaService['librarySceneIndex']['findMany']>>[number],
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
        values
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    );
  }
}
