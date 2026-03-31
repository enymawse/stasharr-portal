import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LibraryScenesFeedDto,
  LibrarySceneFeedItemDto,
} from './dto/library-scenes-feed.dto';
import {
  LibrarySceneSort,
  LibrarySortDirection,
  LibraryTagMatchMode,
} from './dto/library-scenes-query.dto';
import { LibraryStudioOptionDto } from './dto/library-studio-option.dto';
import { LibraryTagOptionDto } from './dto/library-tag-option.dto';
import { LibrarySceneQueryService } from './library-scene-query.service';

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly librarySceneQueryService: LibrarySceneQueryService,
  ) {}

  async getScenesFeed(
    page = LibrarySceneQueryService.DEFAULT_PAGE,
    perPage = LibrarySceneQueryService.DEFAULT_PER_PAGE,
    sort: LibrarySceneSort = LibrarySceneQueryService.DEFAULT_SORT,
    direction: LibrarySortDirection = LibrarySceneQueryService.DEFAULT_DIRECTION,
    query?: string,
    tagIds: string[] = [],
    tagMode: LibraryTagMatchMode = LibrarySceneQueryService.DEFAULT_TAG_MODE,
    studioIds: string[] = [],
    favoritePerformersOnly = false,
    favoriteStudiosOnly = false,
    favoriteTagsOnly = false,
  ): Promise<LibraryScenesFeedDto> {
    return this.librarySceneQueryService.getScenesFeed(page, perPage, {
      sort,
      direction,
      query,
      tagIds,
      tagMode,
      studioIds,
      favoritePerformersOnly,
      favoriteStudiosOnly,
      favoriteTagsOnly,
    });
  }

  async getScenesPreview(
    limit: number,
    sort: LibrarySceneSort = LibrarySceneQueryService.DEFAULT_SORT,
    direction: LibrarySortDirection = LibrarySceneQueryService.DEFAULT_DIRECTION,
    query?: string,
    tagIds: string[] = [],
    tagMode: LibraryTagMatchMode = LibrarySceneQueryService.DEFAULT_TAG_MODE,
    studioIds: string[] = [],
    favoritePerformersOnly = false,
    favoriteStudiosOnly = false,
    favoriteTagsOnly = false,
  ): Promise<LibrarySceneFeedItemDto[]> {
    return this.librarySceneQueryService.getScenesPreview(limit, {
      sort,
      direction,
      query,
      tagIds,
      tagMode,
      studioIds,
      favoritePerformersOnly,
      favoriteStudiosOnly,
      favoriteTagsOnly,
    });
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
}
