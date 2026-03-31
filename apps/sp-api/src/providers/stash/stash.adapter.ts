import { BadGatewayException, Injectable } from '@nestjs/common';
import {
  type CatalogProviderKey,
  findCatalogExternalIdForProvider,
  hasCatalogSceneRef,
  normalizeCatalogSceneRefs,
} from '../catalog/catalog-provider.util';

export interface StashAdapterBaseConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface StashSceneMatch {
  id: string;
  width: number | null;
  height: number | null;
  viewUrl: string;
  label: string;
}

export const STASH_SCENE_FEED_SORT_VALUES = [
  'CREATED_AT',
  'UPDATED_AT',
  'TITLE',
] as const;
export type StashSceneFeedSort = (typeof STASH_SCENE_FEED_SORT_VALUES)[number];

export const STASH_SCENE_FEED_DIRECTION_VALUES = ['ASC', 'DESC'] as const;
export type StashSceneFeedDirection =
  (typeof STASH_SCENE_FEED_DIRECTION_VALUES)[number];
export const STASH_SCENE_FEED_TAG_MODE_VALUES = ['OR', 'AND'] as const;
export type StashSceneFeedTagMode =
  (typeof STASH_SCENE_FEED_TAG_MODE_VALUES)[number];

export interface StashLocalSceneFeedConfig {
  page: number;
  perPage: number;
  sort: StashSceneFeedSort;
  direction: StashSceneFeedDirection;
  titleQuery?: string | null;
  tagIds?: string[];
  tagMode?: StashSceneFeedTagMode | null;
  studioIds?: string[];
  favoritePerformersOnly?: boolean;
  favoriteStudiosOnly?: boolean;
  favoriteTagsOnly?: boolean;
}

export interface StashLocalSceneIdentityPageConfig {
  page: number;
  perPage: number;
}

export interface StashLocalLibraryScenePageConfig {
  page: number;
  perPage: number;
}

export interface StashLinkedSceneStashId {
  endpoint: string;
  stashId: string;
}

export interface StashLocalSceneIdentityItem {
  id: string;
  linkedStashIds: StashLinkedSceneStashId[];
}

export interface StashLocalSceneIdentityPage {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: StashLocalSceneIdentityItem[];
}

export interface StashLocalLibrarySceneItem {
  id: string;
  activeCatalogSceneId: string | null;
  linkedCatalogRefs: string[];
  title: string;
  description: string | null;
  imageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  performerIds: string[];
  performerNames: string[];
  tagIds: string[];
  tagNames: string[];
  releaseDate: string | null;
  duration: number | null;
  viewUrl: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  hasFavoritePerformer: boolean;
  favoriteStudio: boolean;
  hasFavoriteTag: boolean;
}

export interface StashLocalLibraryScenePage {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: StashLocalLibrarySceneItem[];
}

export interface StashSceneMatchOverlayConfig {
  providerKey?: CatalogProviderKey | null;
  favoritePerformersOnly?: boolean;
  favoriteStudiosOnly?: boolean;
  favoriteTagsOnly?: boolean;
}

export interface StashLocalSceneFeedItem {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  cardImageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  releaseDate: string | null;
  duration: number | null;
  viewUrl: string;
}

export interface StashLocalSceneFeed {
  total: number;
  items: StashLocalSceneFeedItem[];
}

export interface StashLocalTagOption {
  id: string;
  name: string;
}

export interface StashLocalStudioOption {
  id: string;
  name: string;
  childStudios: Array<{
    id: string;
    name: string;
  }>;
}

export interface StashProtectedAssetResponse {
  body: Buffer;
  contentType: string | null;
  contentLength: string | null;
  cacheControl: string | null;
}

interface StashLocalSceneRecord {
  id?: unknown;
  title?: unknown;
  details?: unknown;
  date?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  stash_ids?: Array<{
    endpoint?: unknown;
    stash_id?: unknown;
  }> | null;
  paths?: {
    screenshot?: unknown;
  } | null;
  studio?: {
    id?: unknown;
    name?: unknown;
    image_path?: unknown;
    favorite?: unknown;
  } | null;
  performers?: Array<{
    id?: unknown;
    name?: unknown;
    favorite?: unknown;
  }> | null;
  tags?: Array<{
    id?: unknown;
    name?: unknown;
    favorite?: unknown;
  }> | null;
  files?: Array<{
    width?: unknown;
    height?: unknown;
    duration?: unknown;
  }>;
}

interface StashSceneAssetRecord {
  id?: unknown;
  paths?: {
    screenshot?: unknown;
  } | null;
}

interface StashStudioAssetRecord {
  id?: unknown;
  image_path?: unknown;
}

interface StashTagRecord {
  id?: unknown;
  name?: unknown;
}

interface StashStudioSearchRecord {
  id?: unknown;
  name?: unknown;
  parent_studio?: {
    id?: unknown;
    name?: unknown;
  } | null;
  child_studios?: Array<{
    id?: unknown;
    name?: unknown;
  }> | null;
}

interface StashGraphqlResponse {
  data?: {
    findScenes?: {
      count?: unknown;
      scenes?: StashLocalSceneRecord[];
    };
    findScene?: StashSceneAssetRecord | null;
    findStudio?: StashStudioAssetRecord | null;
    findTags?: {
      tags?: StashTagRecord[];
    };
    findStudios?: {
      studios?: StashStudioSearchRecord[];
    };
  };
  errors?: Array<{ message?: unknown }>;
}

@Injectable()
export class StashAdapter {
  async testConnection(config: StashAdapterBaseConfig): Promise<void> {
    const query = `
      query ConnectivityCheck {
        __typename
      }
    `;

    await this.executeQuery(config, query);
  }

  async findScenesByStashId(
    stashId: string,
    config: StashAdapterBaseConfig,
    overlays?: StashSceneMatchOverlayConfig,
  ): Promise<StashSceneMatch[]> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      return [];
    }

    const query = `
      query FindScenes($sceneFilter: SceneFilterType) {
        findScenes(scene_filter: $sceneFilter) {
          count
          scenes {
            id
            files {
              height
              width
            }
            stash_ids {
              endpoint
              stash_id
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      sceneFilter: this.buildSceneMatchFilter(normalizedStashId, overlays),
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];

    return scenes
      .map((scene) =>
        this.toSceneMatch(
          scene,
          config.baseUrl,
          normalizedStashId,
          overlays?.providerKey ?? null,
        ),
      )
      .filter((scene): scene is StashSceneMatch => scene !== null)
      .sort((a, b) => {
        const aHeight = a.height ?? 0;
        const bHeight = b.height ?? 0;
        if (bHeight !== aHeight) {
          return bHeight - aHeight;
        }

        return a.id.localeCompare(b.id);
      });
  }

  async getLocalSceneFeed(
    config: StashAdapterBaseConfig,
    feedConfig: StashLocalSceneFeedConfig,
  ): Promise<StashLocalSceneFeed> {
    const page = this.normalizePositiveInteger(feedConfig.page, 1);
    const perPage = this.normalizePositiveInteger(feedConfig.perPage, 16);
    const sort = this.resolveFeedSort(feedConfig.sort);
    const direction = this.resolveFeedDirection(feedConfig.direction);
    const sceneFilter = this.buildSceneFilter(feedConfig);

    const query = `
      query FindScenes($filter: FindFilterType, $sceneFilter: SceneFilterType) {
        findScenes(filter: $filter, scene_filter: $sceneFilter) {
          count
          scenes {
            id
            title
            details
            date
            paths {
              screenshot
            }
            studio {
              id
              name
              image_path
            }
            files {
              width
              height
              duration
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      filter: {
        page,
        per_page: perPage,
        sort,
        direction,
      },
      sceneFilter,
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];
    const total =
      typeof payload.data?.findScenes?.count === 'number'
        ? payload.data.findScenes.count
        : 0;

    return {
      total,
      items: scenes
        .map((scene) => this.toLocalSceneFeedItem(scene, config.baseUrl))
        .filter((scene): scene is StashLocalSceneFeedItem => scene !== null),
    };
  }

  async getLocalSceneIdentityPage(
    config: StashAdapterBaseConfig,
    pageConfig: StashLocalSceneIdentityPageConfig,
  ): Promise<StashLocalSceneIdentityPage> {
    const page = this.normalizePositiveInteger(pageConfig.page, 1);
    const perPage = this.normalizePositiveInteger(pageConfig.perPage, 250);

    const query = `
      query FindScenes($filter: FindFilterType) {
        findScenes(filter: $filter) {
          count
          scenes {
            id
            stash_ids {
              endpoint
              stash_id
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      filter: {
        page,
        per_page: perPage,
      },
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];
    const total =
      typeof payload.data?.findScenes?.count === 'number'
        ? payload.data.findScenes.count
        : 0;

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: scenes
        .map((scene) => this.toLocalSceneIdentityItem(scene))
        .filter(
          (scene): scene is StashLocalSceneIdentityItem => scene !== null,
        ),
    };
  }

  async getLocalLibraryScenePage(
    config: StashAdapterBaseConfig,
    pageConfig: StashLocalLibraryScenePageConfig,
    activeCatalogProviderKey?: CatalogProviderKey | null,
  ): Promise<StashLocalLibraryScenePage> {
    const page = this.normalizePositiveInteger(pageConfig.page, 1);
    const perPage = this.normalizePositiveInteger(pageConfig.perPage, 100);

    const query = `
      query FindScenes($filter: FindFilterType) {
        findScenes(filter: $filter) {
          count
          scenes {
            id
            title
            details
            date
            created_at
            updated_at
            stash_ids {
              endpoint
              stash_id
            }
            paths {
              screenshot
            }
            studio {
              id
              name
              image_path
              favorite
            }
            performers {
              id
              name
              favorite
            }
            tags {
              id
              name
              favorite
            }
            files {
              duration
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      filter: {
        page,
        per_page: perPage,
        sort: 'updated_at',
        direction: 'DESC',
      },
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];
    const total =
      typeof payload.data?.findScenes?.count === 'number'
        ? payload.data.findScenes.count
        : 0;

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      items: scenes
        .map((scene) =>
          this.toLocalLibrarySceneItem(
            scene,
            config.baseUrl,
            activeCatalogProviderKey ?? null,
          ),
        )
        .filter((scene): scene is StashLocalLibrarySceneItem => scene !== null),
    };
  }

  async searchTags(
    query: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashLocalTagOption[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const gql = `
      query FindTags($filter: FindFilterType) {
        findTags(filter: $filter) {
          tags {
            id
            name
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, gql, {
      filter: {
        q: normalizedQuery,
        page: 1,
        per_page: 25,
      },
    });

    return (payload.data?.findTags?.tags ?? [])
      .map((tag) => this.toTagOption(tag))
      .filter((tag): tag is StashLocalTagOption => tag !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async searchStudios(
    query: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashLocalStudioOption[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const gql = `
      query FindStudios($filter: FindFilterType) {
        findStudios(filter: $filter) {
          studios {
            id
            name
            parent_studio {
              id
              name
            }
            child_studios {
              id
              name
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, gql, {
      filter: {
        q: normalizedQuery,
        page: 1,
        per_page: 25,
      },
    });

    return this.toStudioOptions(payload.data?.findStudios?.studios ?? []);
  }

  async openSceneScreenshot(
    sceneId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashProtectedAssetResponse | null> {
    const normalizedSceneId = this.normalizeEntityId(sceneId);
    if (!normalizedSceneId) {
      return null;
    }

    const query = `
      query FindScene($id: ID!) {
        findScene(id: $id) {
          id
          paths {
            screenshot
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      id: normalizedSceneId,
    });
    const screenshotUrl = this.parseAssetUrl(
      payload.data?.findScene?.paths?.screenshot,
    );
    if (!screenshotUrl) {
      return null;
    }

    return this.fetchProtectedAsset(config, screenshotUrl);
  }

  async openStudioLogo(
    studioId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashProtectedAssetResponse | null> {
    const normalizedStudioId = this.normalizeEntityId(studioId);
    if (!normalizedStudioId) {
      return null;
    }

    const query = `
      query FindStudio($id: ID!) {
        findStudio(id: $id) {
          id
          image_path
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      id: normalizedStudioId,
    });
    const imageUrl = this.parseAssetUrl(payload.data?.findStudio?.image_path);
    if (!imageUrl) {
      return null;
    }

    return this.fetchProtectedAsset(config, imageUrl);
  }

  private pickBestResolution(
    files: Array<{ width?: unknown; height?: unknown }>,
  ): { width: number | null; height: number | null } {
    if (files.length === 0) {
      return { width: null, height: null };
    }

    return files.reduce<{ width: number | null; height: number | null }>(
      (best, file) => {
        const width = typeof file.width === 'number' ? file.width : null;
        const height = typeof file.height === 'number' ? file.height : null;
        const bestHeight = best.height ?? 0;
        const currentHeight = height ?? 0;

        if (currentHeight > bestHeight) {
          return { width, height };
        }

        if (currentHeight === bestHeight) {
          const bestWidth = best.width ?? 0;
          const currentWidth = width ?? 0;
          if (currentWidth > bestWidth) {
            return { width, height };
          }
        }

        return best;
      },
      { width: null, height: null },
    );
  }

  private buildSceneLabel(id: string, height: number | null): string {
    if (height && height > 0) {
      return `${height}p`;
    }

    return `Scene #${id}`;
  }

  private async fetchProtectedAsset(
    config: StashAdapterBaseConfig,
    assetUrl: string,
  ): Promise<StashProtectedAssetResponse | null> {
    const resolvedUrl = this.resolveProtectedAssetUrl(config.baseUrl, assetUrl);
    const headers: Record<string, string> = {};
    if (config.apiKey?.trim()) {
      headers.ApiKey = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetch(resolvedUrl, { headers });
    } catch {
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Stash provider returned ${response.status} for media request.`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    return {
      body: buffer,
      contentType: response.headers.get('content-type'),
      contentLength: String(buffer.byteLength),
      cacheControl: response.headers.get('cache-control'),
    };
  }

  private toLocalSceneFeedItem(
    scene: StashLocalSceneRecord,
    baseUrl: string,
  ): StashLocalSceneFeedItem | null {
    if (typeof scene.id !== 'string' || scene.id.trim().length === 0) {
      return null;
    }

    const title =
      typeof scene.title === 'string' && scene.title.trim().length > 0
        ? scene.title.trim()
        : `Scene #${scene.id}`;
    const description =
      typeof scene.details === 'string' && scene.details.trim().length > 0
        ? scene.details.trim()
        : null;
    const releaseDate =
      typeof scene.date === 'string' && scene.date.trim().length > 0
        ? scene.date.trim()
        : null;
    const imageUrl =
      scene.paths &&
      typeof scene.paths.screenshot === 'string' &&
      scene.paths.screenshot.trim().length > 0
        ? scene.paths.screenshot.trim()
        : null;
    const studioId =
      scene.studio &&
      typeof scene.studio.id === 'string' &&
      scene.studio.id.trim().length > 0
        ? scene.studio.id.trim()
        : null;
    const studio =
      scene.studio &&
      typeof scene.studio.name === 'string' &&
      scene.studio.name.trim().length > 0
        ? scene.studio.name.trim()
        : null;
    const studioImageUrl =
      scene.studio &&
      typeof scene.studio.image_path === 'string' &&
      scene.studio.image_path.trim().length > 0
        ? scene.studio.image_path.trim()
        : null;
    const { width, height } = this.pickBestResolution(scene.files ?? []);
    const duration = this.pickFirstDuration(scene.files ?? []);

    return {
      id: scene.id,
      title,
      description,
      imageUrl,
      cardImageUrl: imageUrl,
      studioId,
      studio,
      studioImageUrl,
      releaseDate,
      duration,
      viewUrl: this.resolveSceneViewUrl(baseUrl, scene.id),
    };
  }

  private toLocalSceneIdentityItem(
    scene: StashLocalSceneRecord,
  ): StashLocalSceneIdentityItem | null {
    const id = this.normalizeOptionalString(scene.id);
    if (!id) {
      return null;
    }

    const linkedStashIds = Array.isArray(scene.stash_ids)
      ? scene.stash_ids
          .map((entry) => this.toLinkedSceneStashId(entry))
          .filter((entry): entry is StashLinkedSceneStashId => entry !== null)
      : [];

    return {
      id,
      linkedStashIds,
    };
  }

  private toLinkedSceneStashId(value: {
    endpoint?: unknown;
    stash_id?: unknown;
  }): StashLinkedSceneStashId | null {
    const endpoint = this.normalizeOptionalString(value.endpoint);
    const stashId = this.normalizeOptionalString(value.stash_id);
    if (!endpoint || !stashId) {
      return null;
    }

    return {
      endpoint,
      stashId,
    };
  }

  private toLocalLibrarySceneItem(
    scene: StashLocalSceneRecord,
    baseUrl: string,
    activeCatalogProviderKey: CatalogProviderKey | null,
  ): StashLocalLibrarySceneItem | null {
    const id = this.normalizeOptionalString(scene.id);
    if (!id) {
      return null;
    }

    const linkedEntries = Array.isArray(scene.stash_ids)
      ? scene.stash_ids
          .map((entry) => this.toLinkedSceneStashId(entry))
          .filter((entry): entry is StashLinkedSceneStashId => entry !== null)
      : [];
    const linkedCatalogRefs = this.toLinkedCatalogRefs(linkedEntries);
    const performers = this.toNamedEntities(scene.performers ?? []);
    const tags = this.toNamedEntities(scene.tags ?? []);
    const duration = this.pickFirstDuration(scene.files ?? []);

    return {
      id,
      activeCatalogSceneId: activeCatalogProviderKey
        ? findCatalogExternalIdForProvider(
            linkedCatalogRefs,
            activeCatalogProviderKey,
          )
        : null,
      linkedCatalogRefs,
      title: this.normalizeOptionalString(scene.title) ?? `Scene #${id}`,
      description: this.normalizeOptionalString(scene.details),
      imageUrl: this.parseAssetUrl(scene.paths?.screenshot),
      studioId: this.normalizeOptionalString(scene.studio?.id),
      studio: this.normalizeOptionalString(scene.studio?.name),
      studioImageUrl: this.normalizeOptionalString(scene.studio?.image_path),
      performerIds: performers.ids,
      performerNames: performers.names,
      tagIds: tags.ids,
      tagNames: tags.names,
      releaseDate: this.normalizeOptionalString(scene.date),
      duration,
      viewUrl: this.resolveSceneViewUrl(baseUrl, id),
      createdAt: this.parseOptionalDate(scene.created_at),
      updatedAt: this.parseOptionalDate(scene.updated_at),
      hasFavoritePerformer: Array.isArray(scene.performers)
        ? scene.performers.some((performer) => performer?.favorite === true)
        : false,
      favoriteStudio: scene.studio?.favorite === true,
      hasFavoriteTag: Array.isArray(scene.tags)
        ? scene.tags.some((tag) => tag?.favorite === true)
        : false,
    };
  }

  private toSceneMatch(
    scene: StashLocalSceneRecord,
    baseUrl: string,
    stashId: string,
    providerKey: CatalogProviderKey | null,
  ): StashSceneMatch | null {
    const id = this.normalizeOptionalString(scene.id);
    if (!id) {
      return null;
    }

    if (providerKey) {
      const linkedEntries = Array.isArray(scene.stash_ids)
        ? scene.stash_ids
            .map((entry) => this.toLinkedSceneStashId(entry))
            .filter((entry): entry is StashLinkedSceneStashId => entry !== null)
        : [];
      const linkedCatalogRefs = this.toLinkedCatalogRefs(linkedEntries);

      if (!hasCatalogSceneRef(linkedCatalogRefs, providerKey, stashId)) {
        return null;
      }
    }

    const { width, height } = this.pickBestResolution(scene.files ?? []);

    return {
      id,
      width,
      height,
      viewUrl: this.resolveSceneViewUrl(baseUrl, id),
      label: this.buildSceneLabel(id, height),
    };
  }

  private buildSceneFilter(
    feedConfig: StashLocalSceneFeedConfig,
  ): Record<string, unknown> | undefined {
    const titleQuery = this.normalizeOptionalString(feedConfig.titleQuery);
    const tagIds = this.normalizeStringArray(feedConfig.tagIds);
    const studioIds = this.normalizeStringArray(feedConfig.studioIds);
    const favoritePerformersOnly = feedConfig.favoritePerformersOnly === true;
    const favoriteStudiosOnly = feedConfig.favoriteStudiosOnly === true;
    const favoriteTagsOnly = feedConfig.favoriteTagsOnly === true;
    const filter: Record<string, unknown> = {};

    if (titleQuery) {
      filter['title'] = {
        value: titleQuery,
        modifier: 'INCLUDES',
      };
    }

    if (tagIds.length > 0) {
      filter['tags'] = {
        value: tagIds,
        modifier: feedConfig.tagMode === 'AND' ? 'INCLUDES_ALL' : 'INCLUDES',
      };
    }

    if (studioIds.length > 0) {
      filter['studios'] = {
        value: studioIds,
        modifier: 'INCLUDES',
      };
    }

    if (favoritePerformersOnly) {
      filter['performers_filter'] = {
        filter_favorites: true,
      };
    }

    if (favoriteStudiosOnly) {
      filter['studios_filter'] = {
        favorite: true,
      };
    }

    if (favoriteTagsOnly) {
      filter['tags_filter'] = {
        favorite: true,
      };
    }

    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private buildSceneMatchFilter(
    stashId: string,
    overlays?: StashSceneMatchOverlayConfig,
  ): Record<string, unknown> {
    const filter: Record<string, unknown> = {
      stash_id_endpoint: {
        modifier: 'EQUALS',
        stash_id: stashId,
      },
    };

    if (overlays?.favoritePerformersOnly === true) {
      filter['performers_filter'] = {
        filter_favorites: true,
      };
    }

    if (overlays?.favoriteStudiosOnly === true) {
      filter['studios_filter'] = {
        favorite: true,
      };
    }

    if (overlays?.favoriteTagsOnly === true) {
      filter['tags_filter'] = {
        favorite: true,
      };
    }

    return filter;
  }

  private toTagOption(tag: StashTagRecord): StashLocalTagOption | null {
    const id = this.normalizeOptionalString(tag.id);
    const name = this.normalizeOptionalString(tag.name);
    if (!id || !name) {
      return null;
    }

    return { id, name };
  }

  private toNamedEntities(
    values: Array<{ id?: unknown; name?: unknown } | null | undefined>,
  ): { ids: string[]; names: string[] } {
    const deduped = new Map<string, string>();

    for (const value of values) {
      const id = this.normalizeOptionalString(value?.id);
      const name = this.normalizeOptionalString(value?.name);
      if (!id || !name || deduped.has(id)) {
        continue;
      }

      deduped.set(id, name);
    }

    return {
      ids: [...deduped.keys()],
      names: [...deduped.values()],
    };
  }

  private toLinkedCatalogRefs(
    linkedEntries: StashLinkedSceneStashId[],
  ): string[] {
    return normalizeCatalogSceneRefs(
      linkedEntries.map((entry) => ({
        endpoint: entry.endpoint,
        externalId: entry.stashId,
      })),
    );
  }

  private toStudioOptions(
    studios: StashStudioSearchRecord[],
  ): StashLocalStudioOption[] {
    const grouped = new Map<
      string,
      {
        id: string;
        name: string;
        childStudios: Map<string, string>;
      }
    >();

    for (const studio of studios) {
      const studioId = this.normalizeOptionalString(studio.id);
      const studioName = this.normalizeOptionalString(studio.name);
      if (!studioId || !studioName) {
        continue;
      }

      const parentId = this.normalizeOptionalString(studio.parent_studio?.id);
      const parentName = this.normalizeOptionalString(
        studio.parent_studio?.name,
      );

      if (parentId && parentName) {
        const group = this.getOrCreateStudioGroup(
          grouped,
          parentId,
          parentName,
        );
        group.childStudios.set(studioId, studioName);
        continue;
      }

      const group = this.getOrCreateStudioGroup(grouped, studioId, studioName);
      for (const child of studio.child_studios ?? []) {
        const childId = this.normalizeOptionalString(child.id);
        const childName = this.normalizeOptionalString(child.name);
        if (childId && childName) {
          group.childStudios.set(childId, childName);
        }
      }
    }

    return [...grouped.values()]
      .map((group) => ({
        id: group.id,
        name: group.name,
        childStudios: [...group.childStudios.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  private getOrCreateStudioGroup(
    groups: Map<
      string,
      {
        id: string;
        name: string;
        childStudios: Map<string, string>;
      }
    >,
    id: string,
    name: string,
  ) {
    const existing = groups.get(id);
    if (existing) {
      return existing;
    }

    const created = {
      id,
      name,
      childStudios: new Map<string, string>(),
    };
    groups.set(id, created);
    return created;
  }

  private pickFirstDuration(
    files: Array<{ duration?: unknown }>,
  ): number | null {
    for (const file of files) {
      if (typeof file.duration === 'number' && Number.isFinite(file.duration)) {
        return file.duration;
      }
    }

    return null;
  }

  private normalizeEntityId(id: string): string | null {
    const normalized = id.trim();
    return /^[A-Za-z0-9_-]+$/.test(normalized) ? normalized : null;
  }

  private normalizeOptionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private normalizeStringArray(values: string[] | undefined): string[] {
    const deduped = new Set<string>();
    for (const value of values ?? []) {
      const normalized = this.normalizeOptionalString(value);
      if (normalized) {
        deduped.add(normalized);
      }
    }

    return [...deduped];
  }

  private parseAssetUrl(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : null;
  }

  private parseOptionalDate(value: unknown): Date | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private resolveProtectedAssetUrl(baseUrl: string, assetUrl: string): string {
    const base = new URL(baseUrl);
    const candidate = new URL(assetUrl, base);

    if (candidate.origin !== base.origin) {
      throw new BadGatewayException(
        'Stash provider returned an unexpected media URL.',
      );
    }

    return candidate.toString();
  }

  private resolveFeedSort(sort: StashSceneFeedSort): string {
    switch (sort) {
      case 'CREATED_AT':
        return 'created_at';
      case 'UPDATED_AT':
        return 'updated_at';
      case 'TITLE':
        return 'title';
      default:
        return 'created_at';
    }
  }

  private resolveFeedDirection(direction: StashSceneFeedDirection): string {
    return direction === 'ASC' ? 'ASC' : 'DESC';
  }

  private normalizePositiveInteger(value: number, fallback: number): number {
    const normalized = Math.floor(Number(value));
    return normalized > 0 ? normalized : fallback;
  }

  private async executeQuery(
    config: StashAdapterBaseConfig,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<StashGraphqlResponse> {
    const endpoint = this.resolveGraphqlEndpoint(config.baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (config.apiKey?.trim()) {
      headers.ApiKey = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new BadGatewayException(
        `Stash provider returned ${response.status}: ${errorBody}`,
      );
    }

    const payload = (await response.json()) as StashGraphqlResponse;

    if (payload.errors && payload.errors.length > 0) {
      const firstError = payload.errors[0]?.message;
      const message =
        typeof firstError === 'string' && firstError.length > 0
          ? firstError
          : 'Stash GraphQL request failed.';
      throw new BadGatewayException(message);
    }

    return payload;
  }

  private resolveGraphqlEndpoint(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');

    if (cleanPath.endsWith('/graphql')) {
      return parsed.toString();
    }

    parsed.pathname = `${cleanPath}/graphql`;
    return parsed.toString();
  }

  private resolveSceneViewUrl(baseUrl: string, sceneId: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/scenes/${encodeURIComponent(sceneId)}`;
    parsed.search = '';
    return parsed.toString();
  }
}
