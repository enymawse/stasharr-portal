import { BadGatewayException, Injectable } from '@nestjs/common';

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
export type StashSceneFeedDirection = (typeof STASH_SCENE_FEED_DIRECTION_VALUES)[number];

export interface StashLocalSceneFeedConfig {
  page: number;
  perPage: number;
  sort: StashSceneFeedSort;
  direction: StashSceneFeedDirection;
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

export interface StashProtectedAssetResponse {
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
  contentLength: string | null;
  cacheControl: string | null;
}

interface StashLocalSceneRecord {
  id?: unknown;
  title?: unknown;
  details?: unknown;
  date?: unknown;
  paths?: {
    screenshot?: unknown;
  } | null;
  studio?: {
    id?: unknown;
    name?: unknown;
    image_path?: unknown;
  } | null;
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

interface StashGraphqlResponse {
  data?: {
    findScenes?: {
      count?: unknown;
      scenes?: StashLocalSceneRecord[];
    };
    findScene?: StashSceneAssetRecord | null;
    findStudio?: StashStudioAssetRecord | null;
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
  ): Promise<StashSceneMatch[]> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      return [];
    }

    const query = `
      query FindScenes($stashId: String!) {
        findScenes(
          scene_filter: {
            stash_id_endpoint: {
              modifier: EQUALS
              stash_id: $stashId
            }
          }
        ) {
          count
          scenes {
            id
            files {
              height
              width
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      stashId: normalizedStashId,
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];

    return scenes
      .map((scene): StashSceneMatch | null => {
        if (typeof scene.id !== 'string' || scene.id.trim().length === 0) {
          return null;
        }

        const { width, height } = this.pickBestResolution(scene.files ?? []);

        return {
          id: scene.id,
          width,
          height,
          viewUrl: this.resolveSceneViewUrl(config.baseUrl, scene.id),
          label: this.buildSceneLabel(scene.id, height),
        };
      })
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

    const query = `
      query FindScenes($filter: FindFilterType) {
        findScenes(filter: $filter) {
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
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];
    const total = typeof payload.data?.findScenes?.count === 'number' ? payload.data.findScenes.count : 0;

    return {
      total,
      items: scenes
        .map((scene) => this.toLocalSceneFeedItem(scene, config.baseUrl))
        .filter((scene): scene is StashLocalSceneFeedItem => scene !== null),
    };
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

    const payload = await this.executeQuery(config, query, { id: normalizedSceneId });
    const screenshotUrl = this.parseAssetUrl(payload.data?.findScene?.paths?.screenshot);
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

    const payload = await this.executeQuery(config, query, { id: normalizedStudioId });
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
      throw new BadGatewayException(`Stash provider returned ${response.status} for media request.`);
    }

    if (!response.body) {
      throw new BadGatewayException('Stash provider returned an empty media response.');
    }

    return {
      body: response.body,
      contentType: response.headers.get('content-type'),
      contentLength: response.headers.get('content-length'),
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

    const title = typeof scene.title === 'string' && scene.title.trim().length > 0
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
      scene.paths && typeof scene.paths.screenshot === 'string' && scene.paths.screenshot.trim().length > 0
        ? scene.paths.screenshot.trim()
        : null;
    const studioId =
      scene.studio && typeof scene.studio.id === 'string' && scene.studio.id.trim().length > 0
        ? scene.studio.id.trim()
        : null;
    const studio =
      scene.studio && typeof scene.studio.name === 'string' && scene.studio.name.trim().length > 0
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

  private parseAssetUrl(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private resolveProtectedAssetUrl(baseUrl: string, assetUrl: string): string {
    const base = new URL(baseUrl);
    const candidate = new URL(assetUrl, base);

    if (candidate.origin !== base.origin) {
      throw new BadGatewayException('Stash provider returned an unexpected media URL.');
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
