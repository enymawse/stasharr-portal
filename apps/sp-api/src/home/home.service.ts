import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  HomeRail,
  HomeRailContentType,
  HomeRailKey,
  HomeRailKind,
  HomeRailSource,
  Prisma,
} from '@prisma/client';
import { LibrarySceneFeedItemDto } from '../library/dto/library-scenes-feed.dto';
import { LibraryService } from '../library/library.service';
import { PrismaService } from '../prisma/prisma.service';
import { type StashdbScene } from '../providers/stashdb/stashdb.adapter';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import { PerformerStudioOptionDto } from '../performers/dto/performer-studio-option.dto';
import { SceneTagOptionDto } from '../scenes/dto/scene-tag-option.dto';
import {
  SceneStatusDto,
  isSceneStatusRequestable,
} from '../scene-status/dto/scene-status.dto';
import { SceneStatusService } from '../scene-status/scene-status.service';
import {
  HOME_RAIL_CONTENT_TYPE_VALUES,
  HOME_RAIL_DIRECTION_VALUES,
  HOME_RAIL_FAVORITES_VALUES,
  HOME_RAIL_LIBRARY_AVAILABILITY_VALUES,
  HOME_RAIL_SCENE_LIMIT_DEFAULT,
  HOME_RAIL_SCENE_LIMIT_MAX,
  HOME_RAIL_SCENE_LIMIT_MIN,
  HOME_RAIL_SOURCE_VALUES,
  type HomeRailLibraryAvailability,
  type HomeRailHybridSceneConfigDto,
  HOME_RAIL_STASH_SCENE_SORT_VALUES,
  HOME_RAIL_STASHDB_SCENE_SORT_VALUES,
  HOME_RAIL_TAG_MODE_VALUES,
  HomeRailDto,
  type HomeRailKey as HomeRailDtoKey,
  type HomeRailSceneConfigDto,
  type HomeRailStashSceneConfigDto,
  type HomeRailStashdbSceneConfigDto,
} from './dto/home-rail.dto';
import { UpdateHomeRailsDto } from './dto/update-home-rails.dto';
import {
  CreateHomeRailDto,
  UpdateHomeRailDto,
} from './dto/create-home-rail.dto';
import {
  HomeRailContentDto,
  HomeRailItemDto,
} from './dto/home-rail-content.dto';
import { HybridScenesService } from '../hybrid-scenes/hybrid-scenes.service';

const DEFAULT_HOME_RAILS: Array<{
  key: HomeRailKey;
  title: string;
  subtitle: string;
  enabled: boolean;
  sortOrder: number;
  source: HomeRailSource;
  contentType: HomeRailContentType;
  config: HomeRailSceneConfigDto;
}> = [
  {
    key: HomeRailKey.FAVORITE_STUDIOS,
    title: 'Latest From Favorite Studios',
    subtitle: 'Recent scenes pulled from the studios you have starred.',
    enabled: true,
    sortOrder: 0,
    source: HomeRailSource.STASHDB,
    contentType: HomeRailContentType.SCENES,
    config: {
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'STUDIO',
      tagIds: [],
      tagNames: [],
      tagMode: null,
      studioIds: [],
      studioNames: [],
      limit: HOME_RAIL_SCENE_LIMIT_DEFAULT,
    },
  },
  {
    key: HomeRailKey.FAVORITE_PERFORMERS,
    title: 'Latest From Favorite Performers',
    subtitle: 'A rolling lineup from performers you are actively tracking.',
    enabled: true,
    sortOrder: 1,
    source: HomeRailSource.STASHDB,
    contentType: HomeRailContentType.SCENES,
    config: {
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'PERFORMER',
      tagIds: [],
      tagNames: [],
      tagMode: null,
      studioIds: [],
      studioNames: [],
      limit: HOME_RAIL_SCENE_LIMIT_DEFAULT,
    },
  },
  {
    key: HomeRailKey.RECENTLY_ADDED_LIBRARY,
    title: 'Recently Added to Library',
    subtitle:
      'Fresh scenes from the indexed local-library projection.',
    enabled: true,
    sortOrder: 2,
    source: HomeRailSource.STASH,
    contentType: HomeRailContentType.SCENES,
    config: {
      sort: 'CREATED_AT',
      direction: 'DESC',
      titleQuery: null,
      tagIds: [],
      tagNames: [],
      tagMode: null,
      studioIds: [],
      studioNames: [],
      favoritePerformersOnly: false,
      favoriteStudiosOnly: false,
      favoriteTagsOnly: false,
      limit: HOME_RAIL_SCENE_LIMIT_DEFAULT,
    },
  },
];

@Injectable()
export class HomeService {
  private readonly logger = new Logger(HomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly libraryService: LibraryService,
    private readonly sceneStatusService: SceneStatusService,
    private readonly hybridScenesService: HybridScenesService,
  ) {}

  async getRails(): Promise<HomeRailDto[]> {
    await this.ensureDefaultRails();
    const rails = await this.listRails();
    return rails.map((rail) => this.toDto(rail));
  }

  async updateRails(payload: UpdateHomeRailsDto): Promise<HomeRailDto[]> {
    await this.ensureDefaultRails();
    const existingRails = await this.listRails();
    this.validateSubmittedRails(payload, existingRails);

    await this.prisma.$transaction(
      payload.rails.map((rail, index) =>
        this.prisma.homeRail.update({
          where: { id: rail.id },
          data: {
            enabled: rail.enabled,
            sortOrder: index,
          },
        }),
      ),
    );

    return this.getRails();
  }

  async createRail(payload: CreateHomeRailDto): Promise<HomeRailDto> {
    await this.ensureDefaultRails();
    const lastRail = await this.prisma.homeRail.findFirst({
      orderBy: { sortOrder: 'desc' },
    });

    const created = await this.prisma.homeRail.create({
      data: {
        key: null,
        kind: HomeRailKind.CUSTOM,
        source: payload.source,
        contentType: HomeRailContentType.SCENES,
        title: payload.title.trim(),
        subtitle: this.normalizeSubtitle(payload.subtitle),
        enabled: payload.enabled,
        sortOrder: (lastRail?.sortOrder ?? -1) + 1,
        config: this.normalizeSceneRailConfig(
          payload.source,
          payload.config,
        ) as unknown as Prisma.InputJsonValue,
      },
    });

    return this.toDto(created);
  }

  async updateRail(
    id: string,
    payload: UpdateHomeRailDto,
  ): Promise<HomeRailDto> {
    await this.ensureDefaultRails();
    const existingRail = await this.requireCustomRail(id);
    if (payload.source !== existingRail.source) {
      throw new BadRequestException(
        'Custom Home rail source cannot be changed after creation.',
      );
    }

    const updated = await this.prisma.homeRail.update({
      where: { id },
      data: {
        title: payload.title.trim(),
        subtitle: this.normalizeSubtitle(payload.subtitle),
        enabled: payload.enabled,
        config: this.normalizeSceneRailConfig(
          existingRail.source,
          payload.config,
        ) as unknown as Prisma.InputJsonValue,
      },
    });

    return this.toDto(updated);
  }

  async deleteRail(id: string): Promise<void> {
    await this.ensureDefaultRails();
    await this.requireCustomRail(id);
    await this.prisma.homeRail.delete({ where: { id } });
    await this.reindexSortOrders();
  }

  async getRailContent(id: string): Promise<HomeRailContentDto> {
    await this.ensureDefaultRails();
    const rail = await this.prisma.homeRail.findUnique({ where: { id } });
    if (!rail) {
      throw new NotFoundException('Home rail not found.');
    }

    if (rail.contentType !== HomeRailContentType.SCENES) {
      throw new BadRequestException('Unsupported Home rail content type.');
    }

    if (rail.source === HomeRailSource.STASH) {
      return this.getStashRailContent(rail);
    }

    if (rail.source === HomeRailSource.HYBRID) {
      return this.getHybridRailContent(rail);
    }

    throw new BadRequestException(
      'This Home rail is loaded through the scenes feed endpoint instead.',
    );
  }

  async searchStashTags(query?: string): Promise<SceneTagOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const tags = await this.libraryService.searchTags(normalizedQuery);
    return tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      description: null,
      aliases: [],
    }));
  }

  async searchStashStudios(
    query?: string,
  ): Promise<PerformerStudioOptionDto[]> {
    const normalizedQuery = query?.trim() ?? '';
    if (!normalizedQuery) {
      return [];
    }

    const studios = await this.libraryService.searchStudios(normalizedQuery);
    return studios.map((studio) => ({
      ...studio,
      childStudios: [],
    }));
  }

  private async ensureDefaultRails(): Promise<void> {
    for (const rail of DEFAULT_HOME_RAILS) {
      await this.prisma.homeRail.upsert({
        where: { key: rail.key },
        update: {
          kind: HomeRailKind.BUILTIN,
          source: rail.source,
          contentType: rail.contentType,
          title: rail.title,
          subtitle: rail.subtitle,
          config: rail.config as unknown as Prisma.InputJsonValue,
        },
        create: {
          key: rail.key,
          kind: HomeRailKind.BUILTIN,
          source: rail.source,
          contentType: rail.contentType,
          title: rail.title,
          subtitle: rail.subtitle,
          enabled: rail.enabled,
          sortOrder: rail.sortOrder,
          config: rail.config as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  private async getStashRailContent(
    rail: HomeRail,
  ): Promise<HomeRailContentDto> {
    const config = this.normalizeSceneRailConfig(
      rail.source,
      rail.config,
      DEFAULT_HOME_RAILS.find((defaultRail) => defaultRail.key === rail.key)
        ?.config ?? null,
    ) as HomeRailStashSceneConfigDto;

    try {
      const items = await this.libraryService.getScenesPreview(
        config.limit,
        config.sort,
        config.direction,
        config.titleQuery ?? undefined,
        config.tagIds,
        config.tagIds.length > 0 ? (config.tagMode ?? 'OR') : undefined,
        config.studioIds,
        config.favoritePerformersOnly,
        config.favoriteStudiosOnly,
        config.favoriteTagsOnly,
      );

      return {
        items: items.map((item) => this.toLocalLibraryRailItem(item)),
        message: null,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to load indexed Home library rail ${rail.id}. ${(error as Error)?.message ?? 'Unknown error.'}`,
      );
      return {
        items: [],
        message: 'Unable to load indexed local-library scenes right now.',
      };
    }
  }

  private async getHybridRailContent(
    rail: HomeRail,
  ): Promise<HomeRailContentDto> {
    let stashdbConfig: { baseUrl: string; apiKey?: string | null };
    let stashConfig: { baseUrl: string; apiKey?: string | null };

    try {
      stashdbConfig = await this.getRequiredStashdbConfig();
    } catch {
      return {
        items: [],
        message:
          'Configure and enable your StashDB integration to populate this hybrid rail.',
      };
    }

    try {
      stashConfig = await this.getRequiredStashConfig();
    } catch {
      return {
        items: [],
        message:
          'Configure and enable your Stash integration to apply library matching.',
      };
    }

    const config = this.normalizeSceneRailConfig(
      rail.source,
      rail.config,
      null,
    ) as HomeRailHybridSceneConfigDto;

    try {
      const matchedScenes = await this.hybridScenesService.getHybridSceneFeed(
        stashdbConfig,
        stashConfig,
        {
          page: 1,
          perPage: config.limit,
          sort: config.sort,
          direction: config.direction,
          stashdbFavorites: config.stashdbFavorites ?? undefined,
          tagIds: config.tagIds,
          tagMode: config.tagMode,
          studioIds: config.studioIds,
          libraryAvailability: config.libraryAvailability,
          stashFavoritePerformersOnly: config.stashFavoritePerformersOnly,
          stashFavoriteStudiosOnly: config.stashFavoriteStudiosOnly,
          stashFavoriteTagsOnly: config.stashFavoriteTagsOnly,
        },
      );
      const statuses =
        config.libraryAvailability === 'MISSING_FROM_LIBRARY'
          ? await this.sceneStatusService.resolveForScenes(
              matchedScenes.scenes.map((scene) => scene.id),
            )
          : new Map<string, { state: 'AVAILABLE' }>();

      return {
        items: matchedScenes.scenes.map((scene) =>
          this.toHybridRailItem(
            scene,
            config.libraryAvailability,
            statuses.get(scene.id) ?? { state: 'AVAILABLE' },
          ),
        ),
        message: null,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to load hybrid Home rail ${rail.id}. ${(error as Error)?.message ?? 'Unknown error.'}`,
      );
      return {
        items: [],
        message: 'Unable to load hybrid library matches right now.',
      };
    }
  }

  private async listRails(): Promise<HomeRail[]> {
    return this.prisma.homeRail.findMany({
      orderBy: { sortOrder: 'asc' },
    });
  }

  private validateSubmittedRails(
    payload: UpdateHomeRailsDto,
    existingRails: HomeRail[],
  ): void {
    const submittedIds = payload.rails.map((rail) => rail.id.trim());
    const uniqueIds = new Set(submittedIds);
    if (uniqueIds.size !== submittedIds.length) {
      throw new BadRequestException(
        'Home rails payload contains duplicate ids.',
      );
    }

    const existingIds = existingRails.map((rail) => rail.id);
    if (
      submittedIds.length !== existingIds.length ||
      existingIds.some((id) => !uniqueIds.has(id))
    ) {
      throw new BadRequestException(
        'Home rails payload must include each persisted rail exactly once.',
      );
    }
  }

  private async requireCustomRail(id: string): Promise<HomeRail> {
    const rail = await this.prisma.homeRail.findUnique({ where: { id } });
    if (!rail) {
      throw new NotFoundException('Home rail not found.');
    }
    if (rail.kind !== HomeRailKind.CUSTOM) {
      throw new BadRequestException(
        'Built-in Home rails cannot be deleted or edited here.',
      );
    }

    return rail;
  }

  private async reindexSortOrders(): Promise<void> {
    const rails = await this.listRails();
    const updates = rails
      .map((rail, index) => ({ rail, index }))
      .filter(({ rail, index }) => rail.sortOrder !== index)
      .map(({ rail, index }) =>
        this.prisma.homeRail.update({
          where: { id: rail.id },
          data: { sortOrder: index },
        }),
      );

    if (updates.length > 0) {
      await this.prisma.$transaction(updates);
    }
  }

  private toDto(rail: HomeRail): HomeRailDto {
    const defaults = rail.key
      ? DEFAULT_HOME_RAILS.find((defaultRail) => defaultRail.key === rail.key)
      : null;

    return {
      id: rail.id,
      key: (rail.key as HomeRailDtoKey | null) ?? null,
      kind: rail.kind,
      source: this.ensureInSet(rail.source, HOME_RAIL_SOURCE_VALUES),
      contentType: this.ensureInSet(
        rail.contentType,
        HOME_RAIL_CONTENT_TYPE_VALUES,
      ),
      title: rail.title,
      subtitle: rail.subtitle,
      enabled: rail.enabled,
      sortOrder: rail.sortOrder,
      editable: rail.kind === HomeRailKind.CUSTOM,
      deletable: rail.kind === HomeRailKind.CUSTOM,
      config: this.normalizeSceneRailConfig(
        rail.source,
        rail.config,
        defaults?.config ?? null,
      ),
    };
  }

  private toLocalLibraryRailItem(
    item: LibrarySceneFeedItemDto,
  ): HomeRailItemDto {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      imageUrl: item.imageUrl,
      cardImageUrl: item.cardImageUrl,
      studioId: item.studioId,
      studio: item.studio,
      studioImageUrl: item.studioImageUrl,
      releaseDate: item.releaseDate,
      duration: item.duration,
      type: 'SCENE',
      source: 'STASH',
      status: { state: 'AVAILABLE' },
      requestable: false,
      viewUrl: item.viewUrl,
    };
  }

  private toHybridRailItem(
    scene: StashdbScene,
    libraryAvailability: HomeRailLibraryAvailability,
    status: SceneStatusDto,
  ): HomeRailItemDto {
    const effectiveStatus =
      libraryAvailability === 'IN_LIBRARY'
        ? { state: 'AVAILABLE' as const }
        : status;

    return {
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
      status: effectiveStatus,
      requestable:
        libraryAvailability === 'MISSING_FROM_LIBRARY' &&
        isSceneStatusRequestable(effectiveStatus),
      viewUrl: null,
    };
  }

  private normalizeSceneRailConfig(
    source: HomeRailSource,
    input: unknown,
    fallback: Partial<HomeRailSceneConfigDto> | null = null,
  ): HomeRailSceneConfigDto {
    const record = this.asRecord(input);
    if (source === HomeRailSource.STASH) {
      return this.normalizeStashSceneRailConfig(record, fallback);
    }
    if (source === HomeRailSource.HYBRID) {
      return this.normalizeHybridSceneRailConfig(record, fallback);
    }

    return this.normalizeStashdbSceneRailConfig(record, fallback);
  }

  private normalizeStashdbSceneRailConfig(
    record: Record<string, unknown>,
    fallback: Partial<HomeRailSceneConfigDto> | null,
  ): HomeRailStashdbSceneConfigDto {
    const fallbackConfig = this.asStashdbSceneConfig(fallback);
    const sort = this.parseInSet(
      record.sort,
      HOME_RAIL_STASHDB_SCENE_SORT_VALUES,
      fallbackConfig?.sort ?? 'DATE',
    );
    const direction = this.parseInSet(
      record.direction,
      HOME_RAIL_DIRECTION_VALUES,
      fallbackConfig?.direction ?? 'DESC',
    );
    const favorites = this.parseOptionalInSet(
      record.favorites,
      HOME_RAIL_FAVORITES_VALUES,
      fallbackConfig?.favorites ?? null,
    );
    const tags = this.normalizeNamedIds(record.tagIds, record.tagNames);
    const studios = this.normalizeNamedIds(
      record.studioIds,
      record.studioNames,
    );
    const fallbackTagMode =
      tags.ids.length > 0 ? (fallbackConfig?.tagMode ?? 'OR') : null;
    const tagMode =
      tags.ids.length > 0
        ? this.parseOptionalInSet(
            record.tagMode,
            HOME_RAIL_TAG_MODE_VALUES,
            fallbackTagMode,
          )
        : null;
    const limit = this.parseLimit(
      record.limit,
      fallbackConfig?.limit ?? HOME_RAIL_SCENE_LIMIT_DEFAULT,
    );

    return {
      sort,
      direction,
      favorites,
      tagIds: tags.ids,
      tagNames: tags.names,
      tagMode,
      studioIds: studios.ids,
      studioNames: studios.names,
      limit,
    };
  }

  private normalizeStashSceneRailConfig(
    record: Record<string, unknown>,
    fallback: Partial<HomeRailSceneConfigDto> | null,
  ): HomeRailStashSceneConfigDto {
    this.ensureNullishField(record.favorites, 'favorites', 'STASH');
    this.ensureNullishField(
      record.stashdbFavorites,
      'stashdbFavorites',
      'STASH',
    );
    this.ensureNullishField(
      record.libraryAvailability,
      'libraryAvailability',
      'STASH',
    );
    this.ensureFalseField(
      record.stashFavoritePerformersOnly,
      'stashFavoritePerformersOnly',
      'STASH',
    );
    this.ensureFalseField(
      record.stashFavoriteStudiosOnly,
      'stashFavoriteStudiosOnly',
      'STASH',
    );
    this.ensureFalseField(
      record.stashFavoriteTagsOnly,
      'stashFavoriteTagsOnly',
      'STASH',
    );

    const fallbackConfig = this.asStashSceneConfig(fallback);
    const sort = this.parseOptionalStrictInSet(
      record.sort,
      HOME_RAIL_STASH_SCENE_SORT_VALUES,
      fallbackConfig?.sort ?? 'CREATED_AT',
      'sort',
    );
    const direction = this.parseOptionalStrictInSet(
      record.direction,
      HOME_RAIL_DIRECTION_VALUES,
      fallbackConfig?.direction ?? 'DESC',
      'direction',
    );
    const titleQuery = this.normalizeOptionalString(
      record.titleQuery,
      fallbackConfig?.titleQuery ?? null,
    );
    const tags = this.normalizeNamedIds(record.tagIds, record.tagNames);
    const studios = this.normalizeNamedIds(
      record.studioIds,
      record.studioNames,
    );
    const fallbackTagMode =
      tags.ids.length > 0 ? (fallbackConfig?.tagMode ?? 'OR') : null;
    const tagMode =
      tags.ids.length > 0
        ? this.parseOptionalStrictNullableInSet(
            record.tagMode,
            HOME_RAIL_TAG_MODE_VALUES,
            fallbackTagMode,
            'tagMode',
          )
        : null;
    const favoritePerformersOnly = this.parseBoolean(
      record.favoritePerformersOnly,
      fallbackConfig?.favoritePerformersOnly ?? false,
    );
    const favoriteStudiosOnly = this.parseBoolean(
      record.favoriteStudiosOnly,
      fallbackConfig?.favoriteStudiosOnly ?? false,
    );
    const favoriteTagsOnly = this.parseBoolean(
      record.favoriteTagsOnly,
      fallbackConfig?.favoriteTagsOnly ?? false,
    );
    const limit = this.parseLimit(
      record.limit,
      fallbackConfig?.limit ?? HOME_RAIL_SCENE_LIMIT_DEFAULT,
    );

    return {
      sort,
      direction,
      titleQuery,
      tagIds: tags.ids,
      tagNames: tags.names,
      tagMode,
      studioIds: studios.ids,
      studioNames: studios.names,
      favoritePerformersOnly,
      favoriteStudiosOnly,
      favoriteTagsOnly,
      limit,
    };
  }

  private normalizeHybridSceneRailConfig(
    record: Record<string, unknown>,
    fallback: Partial<HomeRailSceneConfigDto> | null,
  ): HomeRailHybridSceneConfigDto {
    this.ensureNullishField(record.favorites, 'favorites', 'HYBRID');
    this.ensureNullishField(record.titleQuery, 'titleQuery', 'HYBRID');
    this.ensureFalseField(
      record.favoritePerformersOnly,
      'favoritePerformersOnly',
      'HYBRID',
    );
    this.ensureFalseField(
      record.favoriteStudiosOnly,
      'favoriteStudiosOnly',
      'HYBRID',
    );
    this.ensureFalseField(
      record.favoriteTagsOnly,
      'favoriteTagsOnly',
      'HYBRID',
    );

    const fallbackConfig = this.asHybridSceneConfig(fallback);
    const sort = this.parseOptionalStrictInSet(
      record.sort,
      HOME_RAIL_STASHDB_SCENE_SORT_VALUES,
      fallbackConfig?.sort ?? 'DATE',
      'sort',
    );
    const direction = this.parseOptionalStrictInSet(
      record.direction,
      HOME_RAIL_DIRECTION_VALUES,
      fallbackConfig?.direction ?? 'DESC',
      'direction',
    );
    const stashdbFavorites = this.parseOptionalStrictNullableInSet(
      record.stashdbFavorites,
      HOME_RAIL_FAVORITES_VALUES,
      fallbackConfig?.stashdbFavorites ?? null,
      'stashdbFavorites',
    );
    const tags = this.normalizeNamedIds(record.tagIds, record.tagNames);
    const studios = this.normalizeNamedIds(
      record.studioIds,
      record.studioNames,
    );
    const fallbackTagMode =
      tags.ids.length > 0 ? (fallbackConfig?.tagMode ?? 'OR') : null;
    const tagMode =
      tags.ids.length > 0
        ? this.parseOptionalStrictNullableInSet(
            record.tagMode,
            HOME_RAIL_TAG_MODE_VALUES,
            fallbackTagMode,
            'tagMode',
          )
        : null;
    const libraryAvailability = this.parseOptionalStrictInSet(
      record.libraryAvailability,
      HOME_RAIL_LIBRARY_AVAILABILITY_VALUES,
      fallbackConfig?.libraryAvailability ?? 'MISSING_FROM_LIBRARY',
      'libraryAvailability',
    );
    const stashFavoritePerformersOnly = this.parseBoolean(
      record.stashFavoritePerformersOnly,
      fallbackConfig?.stashFavoritePerformersOnly ?? false,
    );
    const stashFavoriteStudiosOnly = this.parseBoolean(
      record.stashFavoriteStudiosOnly,
      fallbackConfig?.stashFavoriteStudiosOnly ?? false,
    );
    const stashFavoriteTagsOnly = this.parseBoolean(
      record.stashFavoriteTagsOnly,
      fallbackConfig?.stashFavoriteTagsOnly ?? false,
    );
    const limit = this.parseLimit(
      record.limit,
      fallbackConfig?.limit ?? HOME_RAIL_SCENE_LIMIT_DEFAULT,
    );
    const usesStashLocalFavoriteOverlays = libraryAvailability === 'IN_LIBRARY';

    return {
      sort,
      direction,
      stashdbFavorites,
      tagIds: tags.ids,
      tagNames: tags.names,
      tagMode,
      studioIds: studios.ids,
      studioNames: studios.names,
      stashFavoritePerformersOnly: usesStashLocalFavoriteOverlays
        ? stashFavoritePerformersOnly
        : false,
      stashFavoriteStudiosOnly: usesStashLocalFavoriteOverlays
        ? stashFavoriteStudiosOnly
        : false,
      stashFavoriteTagsOnly: usesStashLocalFavoriteOverlays
        ? stashFavoriteTagsOnly
        : false,
      libraryAvailability,
      limit,
    };
  }

  private normalizeNamedIds(
    idsValue: unknown,
    namesValue: unknown,
  ): { ids: string[]; names: string[] } {
    const ids = Array.isArray(idsValue) ? idsValue : [];
    const names = Array.isArray(namesValue) ? namesValue : [];
    const seen = new Set<string>();
    const normalizedIds: string[] = [];
    const normalizedNames: string[] = [];

    ids.forEach((rawId, index) => {
      const id = String(rawId).trim();
      if (!id || seen.has(id)) {
        return;
      }

      seen.add(id);
      normalizedIds.push(id);
      const rawName = names[index];
      if (typeof rawName === 'string' && rawName.trim().length > 0) {
        normalizedNames.push(rawName.trim());
      } else {
        normalizedNames.push(id);
      }
    });

    return {
      ids: normalizedIds,
      names: normalizedNames,
    };
  }

  private ensureNullishField(
    value: unknown,
    fieldName: string,
    source: 'STASH' | 'HYBRID',
  ): void {
    if (value === null || value === undefined || value === '') {
      return;
    }

    throw new BadRequestException(
      `Field ${fieldName} is not supported for ${source} Home rails.`,
    );
  }

  private ensureFalseField(
    value: unknown,
    fieldName: string,
    source: 'STASH' | 'HYBRID',
  ): void {
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      value === false
    ) {
      return;
    }

    throw new BadRequestException(
      `Field ${fieldName} is not supported for ${source} Home rails.`,
    );
  }

  private parseBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    return fallback;
  }

  private parseLimit(value: unknown, fallback: number): number {
    const next = Number(value);
    if (!Number.isInteger(next)) {
      return fallback;
    }

    return Math.min(
      Math.max(next, HOME_RAIL_SCENE_LIMIT_MIN),
      HOME_RAIL_SCENE_LIMIT_MAX,
    );
  }

  private asStashdbSceneConfig(
    value: Partial<HomeRailSceneConfigDto> | null,
  ): Partial<HomeRailStashdbSceneConfigDto> | null {
    if (
      !value ||
      'favorites' in value ||
      'tagIds' in value ||
      'studioIds' in value
    ) {
      return value as Partial<HomeRailStashdbSceneConfigDto> | null;
    }

    return null;
  }

  private asStashSceneConfig(
    value: Partial<HomeRailSceneConfigDto> | null,
  ): Partial<HomeRailStashSceneConfigDto> | null {
    if (!value) {
      return null;
    }

    return {
      sort: value.sort as HomeRailStashSceneConfigDto['sort'],
      direction: value.direction,
      titleQuery:
        'titleQuery' in value && typeof value.titleQuery === 'string'
          ? value.titleQuery
          : null,
      tagIds:
        'tagIds' in value && Array.isArray(value.tagIds) ? value.tagIds : [],
      tagNames:
        'tagNames' in value && Array.isArray(value.tagNames)
          ? value.tagNames
          : [],
      tagMode:
        'tagMode' in value && typeof value.tagMode === 'string'
          ? (value.tagMode as HomeRailStashSceneConfigDto['tagMode'])
          : null,
      studioIds:
        'studioIds' in value && Array.isArray(value.studioIds)
          ? value.studioIds
          : [],
      studioNames:
        'studioNames' in value && Array.isArray(value.studioNames)
          ? value.studioNames
          : [],
      favoritePerformersOnly:
        'favoritePerformersOnly' in value &&
        value.favoritePerformersOnly === true,
      favoriteStudiosOnly:
        'favoriteStudiosOnly' in value && value.favoriteStudiosOnly === true,
      favoriteTagsOnly:
        'favoriteTagsOnly' in value && value.favoriteTagsOnly === true,
      limit: value.limit,
    };
  }

  private asHybridSceneConfig(
    value: Partial<HomeRailSceneConfigDto> | null,
  ): Partial<HomeRailHybridSceneConfigDto> | null {
    if (!value) {
      return null;
    }

    if ('stashdbFavorites' in value || 'libraryAvailability' in value) {
      return value as Partial<HomeRailHybridSceneConfigDto>;
    }

    return null;
  }

  private parseOptionalInSet<const T extends readonly string[]>(
    value: unknown,
    validValues: T,
    fallback: T[number] | null,
  ): T[number] | null {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }

    return this.parseInSet(value, validValues, fallback ?? validValues[0]);
  }

  private parseOptionalStrictInSet<const T extends readonly string[]>(
    value: unknown,
    validValues: T,
    fallback: T[number],
    fieldName: string,
  ): T[number] {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }

    if (typeof value === 'string' && validValues.includes(value as T[number])) {
      return value as T[number];
    }

    throw new BadRequestException(
      `Unsupported ${fieldName} value for this Home rail source.`,
    );
  }

  private parseOptionalStrictNullableInSet<const T extends readonly string[]>(
    value: unknown,
    validValues: T,
    fallback: T[number] | null,
    fieldName: string,
  ): T[number] | null {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }

    if (typeof value === 'string' && validValues.includes(value as T[number])) {
      return value as T[number];
    }

    throw new BadRequestException(
      `Unsupported ${fieldName} value for this Home rail source.`,
    );
  }

  private parseInSet<const T extends readonly string[]>(
    value: unknown,
    validValues: T,
    fallback: T[number],
  ): T[number] {
    return typeof value === 'string' && validValues.includes(value as T[number])
      ? (value as T[number])
      : fallback;
  }

  private ensureInSet<const T extends readonly string[]>(
    value: string,
    validValues: T,
  ): T[number] {
    if (!validValues.includes(value as T[number])) {
      throw new BadRequestException(`Unsupported Home rail value: ${value}`);
    }

    return value as T[number];
  }

  private normalizeSubtitle(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private normalizeOptionalString(
    value: unknown,
    fallback: string | null,
  ): string | null {
    if (typeof value !== 'string') {
      return fallback;
    }

    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private async getRequiredStashConfig(): Promise<{
    baseUrl: string;
    apiKey?: string | null;
  }> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { type: 'STASH' },
    });

    if (!integration) {
      throw new ConflictException('STASH integration is not configured.');
    }

    if (!integration.enabled) {
      throw new ConflictException('STASH integration is disabled.');
    }

    if (integration.status !== 'CONFIGURED') {
      throw new ConflictException('STASH integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new BadRequestException('STASH integration is missing a base URL.');
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }

  private async getRequiredStashdbConfig(): Promise<{
    baseUrl: string;
    apiKey?: string | null;
  }> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { type: 'STASHDB' },
    });

    if (!integration) {
      throw new ConflictException('STASHDB integration is not configured.');
    }

    if (!integration.enabled) {
      throw new ConflictException('STASHDB integration is disabled.');
    }

    if (integration.status !== 'CONFIGURED') {
      throw new ConflictException('STASHDB integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new BadRequestException(
        'STASHDB integration is missing a base URL.',
      );
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }
}
