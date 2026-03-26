import { Injectable } from '@nestjs/common';
import {
  StashAdapter,
  type StashAdapterBaseConfig,
} from '../providers/stash/stash.adapter';
import {
  StashdbAdapter,
  type StashdbAdapterBaseConfig,
  type StashdbScene,
  type StashdbSceneFeedFavorites,
  type StashdbSceneFeedSort,
  type StashdbSceneTagFilterMode,
  type StashdbSortDirection,
} from '../providers/stashdb/stashdb.adapter';

export const HYBRID_SCENE_LIBRARY_AVAILABILITY_VALUES = [
  'ANY',
  'IN_LIBRARY',
  'MISSING_FROM_LIBRARY',
] as const;
export type HybridSceneLibraryAvailability =
  (typeof HYBRID_SCENE_LIBRARY_AVAILABILITY_VALUES)[number];

export interface HybridSceneFeedConfig {
  page: number;
  perPage: number;
  sort: StashdbSceneFeedSort;
  direction: StashdbSortDirection;
  stashdbFavorites?: StashdbSceneFeedFavorites;
  tagIds?: string[];
  tagMode?: StashdbSceneTagFilterMode | null;
  studioIds?: string[];
  libraryAvailability: HybridSceneLibraryAvailability;
  stashFavoritePerformersOnly?: boolean;
  stashFavoriteStudiosOnly?: boolean;
  stashFavoriteTagsOnly?: boolean;
}

export interface HybridSceneFeedResult {
  scenes: StashdbScene[];
  total: null;
  hasMore: boolean;
  effectiveAvailability: Exclude<HybridSceneLibraryAvailability, 'ANY'>;
}

@Injectable()
export class HybridScenesService {
  private static readonly LOOKUP_CONCURRENCY = 6;
  private static readonly OVERSCAN_FACTOR = 5;
  private static readonly PAGE_SIZE_MAX = 50;

  constructor(
    private readonly stashAdapter: StashAdapter,
    private readonly stashdbAdapter: StashdbAdapter,
  ) {}

  async getHybridSceneFeed(
    stashdbConfig: StashdbAdapterBaseConfig,
    stashConfig: StashAdapterBaseConfig,
    config: HybridSceneFeedConfig,
  ): Promise<HybridSceneFeedResult> {
    const page = Math.max(1, Math.trunc(config.page) || 1);
    const perPage = Math.max(1, Math.trunc(config.perPage) || 1);
    const startIndex = (page - 1) * perPage;
    const endIndexExclusive = startIndex + perPage;
    const overscannedMatchTarget = endIndexExclusive + 1;
    const maxInspected = Math.max(
      overscannedMatchTarget * HybridScenesService.OVERSCAN_FACTOR,
      perPage * HybridScenesService.OVERSCAN_FACTOR,
    );
    const pageSize = Math.min(
      Math.max(perPage * 2, perPage),
      HybridScenesService.PAGE_SIZE_MAX,
    );
    const effectiveAvailability = this.resolveEffectiveAvailability(config);
    const desiredInLibrary = effectiveAvailability === 'IN_LIBRARY';
    const normalizedTagIds = this.dedupeStrings(config.tagIds ?? []);
    const normalizedStudioIds = this.dedupeStrings(config.studioIds ?? []);
    const availabilityCache = new Map<string, boolean>();
    const matched: StashdbScene[] = [];
    let inspected = 0;
    let currentCandidatePage = 1;
    let totalCandidates = Number.POSITIVE_INFINITY;
    let reachedEndOfCandidates = false;

    while (
      matched.length < overscannedMatchTarget &&
      inspected < maxInspected &&
      (currentCandidatePage - 1) * pageSize < totalCandidates
    ) {
      const candidatePage = await this.stashdbAdapter.getScenesBySort({
        ...stashdbConfig,
        page: currentCandidatePage,
        perPage: pageSize,
        sort: config.sort,
        direction: config.direction,
        favorites: config.stashdbFavorites,
        studioIds: normalizedStudioIds,
        tagFilter:
          normalizedTagIds.length > 0
            ? {
                tagIds: normalizedTagIds,
                mode: config.tagMode ?? 'OR',
              }
            : undefined,
      });

      totalCandidates = candidatePage.total;
      const pageScenes = candidatePage.scenes.slice(0, maxInspected - inspected);
      if (pageScenes.length === 0) {
        reachedEndOfCandidates = true;
        break;
      }

      const pageMatches = await this.mapWithConcurrency(
        pageScenes,
        HybridScenesService.LOOKUP_CONCURRENCY,
        async (scene) => {
          const inLibrary = await this.resolveHybridLibraryAvailability(
            scene.id,
            stashConfig,
            config,
            availabilityCache,
          );
          return { scene, inLibrary };
        },
      );

      inspected += pageScenes.length;

      for (const result of pageMatches) {
        if (result.inLibrary === desiredInLibrary) {
          matched.push(result.scene);
          if (matched.length >= overscannedMatchTarget) {
            break;
          }
        }
      }

      if (candidatePage.scenes.length < pageSize) {
        reachedEndOfCandidates = true;
        break;
      }

      currentCandidatePage += 1;
    }

    const scenes = matched.slice(startIndex, endIndexExclusive);
    const hasMore =
      matched.length > endIndexExclusive ||
      (!reachedEndOfCandidates && scenes.length > 0 && inspected < totalCandidates);

    return {
      scenes,
      total: null,
      hasMore,
      effectiveAvailability,
    };
  }

  private resolveEffectiveAvailability(
    config: HybridSceneFeedConfig,
  ): Exclude<HybridSceneLibraryAvailability, 'ANY'> {
    if (config.libraryAvailability === 'IN_LIBRARY') {
      return 'IN_LIBRARY';
    }

    if (config.libraryAvailability === 'MISSING_FROM_LIBRARY') {
      return 'MISSING_FROM_LIBRARY';
    }

    return this.usesStashLocalFavoriteOverlays(config)
      ? 'IN_LIBRARY'
      : 'MISSING_FROM_LIBRARY';
  }

  private usesStashLocalFavoriteOverlays(config: HybridSceneFeedConfig): boolean {
    return Boolean(
      config.stashFavoritePerformersOnly ||
        config.stashFavoriteStudiosOnly ||
        config.stashFavoriteTagsOnly,
    );
  }

  private async resolveHybridLibraryAvailability(
    stashId: string,
    stashConfig: StashAdapterBaseConfig,
    config: HybridSceneFeedConfig,
    cache: Map<string, boolean>,
  ): Promise<boolean> {
    const cached = cache.get(stashId);
    if (cached !== undefined) {
      return cached;
    }

    const matches = await this.stashAdapter.findScenesByStashId(stashId, stashConfig, {
      favoritePerformersOnly: config.stashFavoritePerformersOnly,
      favoriteStudiosOnly: config.stashFavoriteStudiosOnly,
      favoriteTagsOnly: config.stashFavoriteTagsOnly,
    });
    const inLibrary = matches.length > 0;
    cache.set(stashId, inLibrary);
    return inLibrary;
  }

  private async mapWithConcurrency<TInput, TOutput>(
    items: TInput[],
    concurrency: number,
    mapper: (item: TInput, index: number) => Promise<TOutput>,
  ): Promise<TOutput[]> {
    const results = new Array<TOutput>(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await mapper(items[currentIndex] as TInput, currentIndex);
      }
    });

    await Promise.all(workers);
    return results;
  }

  private dedupeStrings(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  }
}
