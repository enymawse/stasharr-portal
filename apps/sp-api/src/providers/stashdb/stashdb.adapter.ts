import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

export interface StashdbAdapterBaseConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface StashdbAdapterTrendingConfig extends StashdbAdapterBaseConfig {
  page: number;
  perPage: number;
}

export type StashdbSceneFeedSort =
  | 'DATE'
  | 'TRENDING'
  | 'TITLE'
  | 'CREATED_AT'
  | 'UPDATED_AT';

export interface StashdbAdapterSceneFeedConfig
  extends StashdbAdapterTrendingConfig {
  sort: StashdbSceneFeedSort;
  favorites?: StashdbSceneFeedFavorites;
  tagFilter?: StashdbSceneTagFilter;
}

export type StashdbSceneFeedFavorites = 'PERFORMER' | 'STUDIO' | 'ALL';

export type StashdbSceneTagFilterMode = 'OR' | 'AND';

export interface StashdbSceneTagFilter {
  tagIds: string[];
  mode: StashdbSceneTagFilterMode;
}

export interface StashdbTagSearchConfig extends StashdbAdapterBaseConfig {
  query: string;
}

export interface StashdbScene {
  id: string;
  title: string;
  details: string | null;
  imageUrl: string | null;
  studioName: string | null;
  studioImageUrl: string | null;
  date: string | null;
  releaseDate: string | null;
  productionDate: string | null;
  duration: number | null;
}

export interface StashdbTrendingScenesResult {
  total: number;
  scenes: StashdbScene[];
}

export interface StashdbSceneImage {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface StashdbSceneTag {
  id: string;
  name: string;
  description: string | null;
}

export interface StashdbTagOption {
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
}

export interface StashdbScenePerformer {
  id: string;
  name: string;
  gender: string | null;
  isFavorite: boolean;
  imageUrl: string | null;
}

export interface StashdbSceneUrl {
  url: string;
  type: string | null;
}

export interface StashdbSceneDetails {
  id: string;
  title: string;
  details: string | null;
  imageUrl: string | null;
  images: StashdbSceneImage[];
  studioName: string | null;
  studioImageUrl: string | null;
  releaseDate: string | null;
  duration: number | null;
  tags: StashdbSceneTag[];
  performers: StashdbScenePerformer[];
  sourceUrls: StashdbSceneUrl[];
}

interface StashdbGraphqlResponse {
  data?: {
    queryScenes?: {
      count?: unknown;
      scenes?: Array<{
        id?: unknown;
        title?: unknown;
        details?: unknown;
        date?: unknown;
        release_date?: unknown;
        production_date?: unknown;
        images?: Array<{
          id?: unknown;
          url?: unknown;
          width?: unknown;
          height?: unknown;
        }>;
        studio?: {
          id?: unknown;
          name?: unknown;
          images?: Array<{
            id?: unknown;
            url?: unknown;
            width?: unknown;
            height?: unknown;
          }>;
        } | null;
        duration?: unknown;
      }>;
    };
    queryTags?: {
      tags?: Array<{
        id?: unknown;
        name?: unknown;
        description?: unknown;
        aliases?: unknown;
      }>;
    };
    findScene?: {
      id?: unknown;
      title?: unknown;
      details?: unknown;
      date?: unknown;
      release_date?: unknown;
      production_date?: unknown;
      duration?: unknown;
      images?: Array<{
        id?: unknown;
        url?: unknown;
        width?: unknown;
        height?: unknown;
      }>;
      tags?: Array<{
        id?: unknown;
        name?: unknown;
        description?: unknown;
      }>;
      studio?: {
        id?: unknown;
        name?: unknown;
        is_favorite?: unknown;
        images?: Array<{
          id?: unknown;
          url?: unknown;
          width?: unknown;
          height?: unknown;
        }>;
      } | null;
      urls?: Array<{
        url?: unknown;
        type?: unknown;
      }>;
      performers?: Array<{
        performer?: {
          id?: unknown;
          name?: unknown;
          gender?: unknown;
          is_favorite?: unknown;
          images?: Array<{
            id?: unknown;
            url?: unknown;
            width?: unknown;
            height?: unknown;
          }>;
        } | null;
      }>;
    } | null;
  };
  errors?: Array<{ message?: unknown }>;
}

@Injectable()
export class StashdbAdapter {
  async testConnection(config: StashdbAdapterBaseConfig): Promise<void> {
    const query = `
      query ConnectivityCheck {
        __typename
      }
    `;

    await this.executeQuery(config, query);
  }

  async getTrendingScenes(
    config: StashdbAdapterTrendingConfig,
  ): Promise<StashdbTrendingScenesResult> {
    return this.getSceneFeed(config, 'TRENDING');
  }

  async getScenesSortedByDate(
    config: StashdbAdapterTrendingConfig,
  ): Promise<StashdbTrendingScenesResult> {
    return this.getSceneFeed(config, 'DATE');
  }

  async getScenesBySort(
    config: StashdbAdapterSceneFeedConfig,
  ): Promise<StashdbTrendingScenesResult> {
    return this.getSceneFeed(config, config.sort);
  }

  async searchTags(config: StashdbTagSearchConfig): Promise<StashdbTagOption[]> {
    const query = `
      query QueryTags($name: String!) {
        queryTags(input: { direction: ASC, sort: NAME, name: $name }) {
          tags {
            id
            name
            description
            aliases
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, { name: config.query });
    const rawTags = payload.data?.queryTags?.tags ?? [];

    return rawTags
      .map((tag): StashdbTagOption | null => {
        if (typeof tag.id !== 'string' || typeof tag.name !== 'string') {
          return null;
        }

        const aliases = Array.isArray(tag.aliases)
          ? tag.aliases.filter((alias): alias is string => typeof alias === 'string')
          : [];

        return {
          id: tag.id,
          name: tag.name,
          description:
            typeof tag.description === 'string' && tag.description.trim().length > 0
              ? tag.description
              : null,
          aliases,
        };
      })
      .filter((tag): tag is StashdbTagOption => tag !== null);
  }

  private async getSceneFeed(
    config: StashdbAdapterSceneFeedConfig | StashdbAdapterTrendingConfig,
    sort: StashdbSceneFeedSort,
  ): Promise<StashdbTrendingScenesResult> {
    const favorites =
      'favorites' in config && config.favorites ? config.favorites : null;
    const tagFilter =
      'tagFilter' in config &&
      config.tagFilter?.tagIds.length &&
      config.tagFilter.tagIds.length > 0
        ? config.tagFilter
        : null;
    const tagModifier =
      tagFilter?.mode === 'AND' ? 'INCLUDES_ALL' : 'INCLUDES';
    const tagVariableDeclaration = tagFilter ? ', $tagIds: [ID!]!' : '';
    const favoritesInput = favorites ? `, favorites: ${favorites}` : '';
    const tagInput = tagFilter
      ? `, tags: { value: $tagIds, modifier: ${tagModifier} }`
      : '';
    const query = `
      query QueryScenes($page: Int!, $perPage: Int!${tagVariableDeclaration}) {
        queryScenes(input: { sort: ${sort}, direction: DESC, page: $page, per_page: $perPage${favoritesInput}${tagInput} }) {
          count
          scenes {
            id
            title
            details
            date
            release_date
            created
            updated
            production_date
            images {
              id
              url
              width
              height
            }
            studio {
              id
              name
              images {
                id
                url
                width
                height
              }
            }
            duration
          }
        }
      }
    `;
    const variables: Record<string, unknown> = {
      page: config.page,
      perPage: config.perPage,
    };
    if (tagFilter) {
      variables.tagIds = tagFilter.tagIds;
    }

    const payload = await this.executeQuery(config, query, variables);

    const total =
      typeof payload.data?.queryScenes?.count === 'number'
        ? payload.data.queryScenes.count
        : 0;
    const rawScenes = payload.data?.queryScenes?.scenes ?? [];
    const scenes = rawScenes
      .map((scene): StashdbScene | null => {
        if (typeof scene.id !== 'string' || typeof scene.title !== 'string') {
          return null;
        }

        const sceneImageUrl = this.selectPrimaryImage(
          this.normalizeImages(scene.images),
        )?.url;
        const studioImageUrl = this.selectPrimaryImage(
          this.normalizeImages(scene.studio?.images),
        )?.url;

        return {
          id: scene.id,
          title: scene.title,
          details:
            typeof scene.details === 'string' && scene.details.trim().length > 0
              ? scene.details
              : null,
          imageUrl: sceneImageUrl ?? null,
          studioName:
            typeof scene.studio?.name === 'string' &&
            scene.studio.name.length > 0
              ? scene.studio.name
              : null,
          studioImageUrl: studioImageUrl ?? null,
          date:
            typeof scene.date === 'string' && scene.date.length > 0
              ? scene.date
              : null,
          releaseDate:
            typeof scene.release_date === 'string' &&
            scene.release_date.length > 0
              ? scene.release_date
              : null,
          productionDate:
            typeof scene.production_date === 'string' &&
            scene.production_date.length > 0
              ? scene.production_date
              : null,
          duration: typeof scene.duration === 'number' ? scene.duration : null,
        };
      })
      .filter((scene): scene is StashdbScene => scene !== null);

    return { total, scenes };
  }

  async getSceneById(
    sceneId: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbSceneDetails> {
    const query = `
      query FindScene($id: ID!) {
        findScene(id: $id) {
          id
          title
          details
          date
          release_date
          production_date
          duration
          created
          updated
          images {
            id
            url
            width
            height
          }
          tags {
            id
            name
            description
          }
          studio {
            id
            name
            is_favorite
            images {
              id
              url
              width
              height
            }
          }
          urls {
            url
            type
          }
          performers {
            performer {
              id
              name
              gender
              is_favorite
              images {
                id
                url
                width
                height
              }
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, { id: sceneId });
    const scene = payload.data?.findScene;

    if (!scene) {
      throw new NotFoundException(`Scene ${sceneId} not found in StashDB.`);
    }

    if (typeof scene.id !== 'string' || typeof scene.title !== 'string') {
      throw new BadGatewayException(
        'StashDB scene response is missing required fields.',
      );
    }

    const images = (scene.images ?? [])
      .map((image): StashdbSceneImage | null => {
        if (typeof image.url !== 'string') {
          return null;
        }

        const id =
          typeof image.id === 'string' && image.id.length > 0
            ? image.id
            : image.url;

        return {
          id,
          url: image.url,
          width: typeof image.width === 'number' ? image.width : null,
          height: typeof image.height === 'number' ? image.height : null,
        };
      })
      .filter((image): image is StashdbSceneImage => image !== null);

    const primaryImage = this.selectPrimaryImage(images);
    const studioImageUrl = this.selectPrimaryImage(
      this.normalizeImages(scene.studio?.images),
    )?.url;

    const tags = (scene.tags ?? [])
      .map((tag): StashdbSceneTag | null => {
        if (typeof tag.id !== 'string' || typeof tag.name !== 'string') {
          return null;
        }

        return {
          id: tag.id,
          name: tag.name,
          description:
            typeof tag.description === 'string' &&
            tag.description.trim().length > 0
              ? tag.description
              : null,
        };
      })
      .filter((tag): tag is StashdbSceneTag => tag !== null);

    const performers = (scene.performers ?? [])
      .map((entry): StashdbScenePerformer | null => {
        const performer = entry.performer;
        if (
          !performer ||
          typeof performer.id !== 'string' ||
          typeof performer.name !== 'string'
        ) {
          return null;
        }

        return {
          id: performer.id,
          name: performer.name,
          gender:
            typeof performer.gender === 'string' ? performer.gender : null,
          isFavorite: performer.is_favorite === true,
          imageUrl:
            this.selectPrimaryImage(
              (performer.images ?? [])
                .map((image): StashdbSceneImage | null => {
                  if (
                    typeof image.id !== 'string' ||
                    typeof image.url !== 'string'
                  ) {
                    return null;
                  }

                  return {
                    id: image.id,
                    url: image.url,
                    width: typeof image.width === 'number' ? image.width : null,
                    height:
                      typeof image.height === 'number' ? image.height : null,
                  };
                })
                .filter((image): image is StashdbSceneImage => image !== null),
            )?.url ?? null,
        };
      })
      .filter(
        (performer): performer is StashdbScenePerformer => performer !== null,
      );

    const sourceUrls = (scene.urls ?? [])
      .map((sourceUrl): StashdbSceneUrl | null => {
        if (typeof sourceUrl.url !== 'string') {
          return null;
        }

        return {
          url: sourceUrl.url,
          type: typeof sourceUrl.type === 'string' ? sourceUrl.type : null,
        };
      })
      .filter((sourceUrl): sourceUrl is StashdbSceneUrl => sourceUrl !== null);

    const releaseDate =
      (typeof scene.release_date === 'string' && scene.release_date.length > 0
        ? scene.release_date
        : null) ??
      (typeof scene.production_date === 'string' &&
      scene.production_date.length > 0
        ? scene.production_date
        : null) ??
      (typeof scene.date === 'string' && scene.date.length > 0
        ? scene.date
        : null);

    return {
      id: scene.id,
      title: scene.title,
      details:
        typeof scene.details === 'string' && scene.details.trim().length > 0
          ? scene.details
          : null,
      imageUrl: primaryImage?.url ?? null,
      images,
      studioName:
        typeof scene.studio?.name === 'string' && scene.studio.name.length > 0
          ? scene.studio.name
          : null,
      studioImageUrl: studioImageUrl ?? null,
      releaseDate,
      duration: typeof scene.duration === 'number' ? scene.duration : null,
      tags,
      performers,
      sourceUrls,
    };
  }

  private selectPrimaryImage(
    images: StashdbSceneImage[],
  ): StashdbSceneImage | null {
    if (images.length === 0) {
      return null;
    }

    return images.reduce<StashdbSceneImage>((best, current) => {
      const bestWidth = best.width ?? 0;
      const currentWidth = current.width ?? 0;
      return currentWidth > bestWidth ? current : best;
    }, images[0]);
  }

  private normalizeImages(
    images:
      | Array<{
          id?: unknown;
          url?: unknown;
          width?: unknown;
          height?: unknown;
        }>
      | null
      | undefined,
  ): StashdbSceneImage[] {
    return (images ?? [])
      .map((image): StashdbSceneImage | null => {
        if (typeof image.id !== 'string' || typeof image.url !== 'string') {
          return null;
        }

        return {
          id: image.id,
          url: image.url,
          width: typeof image.width === 'number' ? image.width : null,
          height: typeof image.height === 'number' ? image.height : null,
        };
      })
      .filter((image): image is StashdbSceneImage => image !== null);
  }

  private async executeQuery(
    config: StashdbAdapterBaseConfig,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<StashdbGraphqlResponse> {
    const endpoint = this.resolveGraphqlEndpoint(config.baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey?.trim()) {
      headers.ApiKey = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables,
        }),
      });
    } catch {
      throw new BadGatewayException(
        'Failed to reach StashDB provider endpoint.',
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new BadGatewayException(
        `StashDB provider returned ${response.status}: ${errorBody}`,
      );
    }

    const payload = (await response.json()) as StashdbGraphqlResponse;

    if (payload.errors && payload.errors.length > 0) {
      const firstError = payload.errors[0]?.message;
      const message =
        typeof firstError === 'string' && firstError.length > 0
          ? firstError
          : 'StashDB GraphQL request failed.';
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
}
