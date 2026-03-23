import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

export interface StashdbAdapterBaseConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface StashdbFavoriteResult {
  favorited: boolean;
  alreadyFavorited: boolean;
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
  studioIds?: string[];
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

export type StashdbPerformerSort =
  | 'NAME'
  | 'BIRTHDATE'
  | 'DEATHDATE'
  | 'SCENE_COUNT'
  | 'CAREER_START_YEAR'
  | 'DEBUT'
  | 'LAST_SCENE'
  | 'CREATED_AT'
  | 'UPDATED_AT';

export type StashdbPerformerGender =
  | 'MALE'
  | 'FEMALE'
  | 'UNKNOWN'
  | 'TRANSGENDER_MALE'
  | 'TRANSGENDER_FEMALE'
  | 'INTERSEX'
  | 'NON_BINARY';

export interface StashdbPerformerFeedConfig extends StashdbAdapterBaseConfig {
  page: number;
  perPage: number;
  name?: string;
  gender?: StashdbPerformerGender;
  sort?: StashdbPerformerSort;
  favoritesOnly?: boolean;
}

export interface StashdbPerformerDetails {
  id: string;
  name: string;
  disambiguation: string | null;
  aliases: string[];
  gender: StashdbPerformerGender | null;
  birthDate: string | null;
  deathDate: string | null;
  age: number | null;
  ethnicity: string | null;
  country: string | null;
  eyeColor: string | null;
  hairColor: string | null;
  height: string | null;
  cupSize: string | null;
  bandSize: number | null;
  waistSize: number | null;
  hipSize: number | null;
  breastType: string | null;
  careerStartYear: number | null;
  careerEndYear: number | null;
  deleted: boolean;
  mergedIds: string[];
  mergedIntoId: string | null;
  isFavorite: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  imageUrl: string | null;
  images: StashdbSceneImage[];
}

export interface StashdbStudioOption {
  id: string;
  name: string;
  childStudios: Array<{
    id: string;
    name: string;
  }>;
}

export interface StashdbPerformerScenesConfig extends StashdbAdapterBaseConfig {
  performerId: string;
  page: number;
  perPage: number;
  sort: StashdbSceneFeedSort;
  studioIds?: string[];
  tagIds?: string[];
  onlyFavoriteStudios?: boolean;
}

export interface StashdbScene {
  id: string;
  title: string;
  details: string | null;
  imageUrl: string | null;
  studioId: string | null;
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

export interface StashdbPerformerFeedItem {
  id: string;
  name: string;
  gender: StashdbPerformerGender | null;
  sceneCount: number;
  isFavorite: boolean;
  imageUrl: string | null;
}

export interface StashdbPerformersFeedResult {
  total: number;
  performers: StashdbPerformerFeedItem[];
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
  studioId: string | null;
  studioIsFavorite: boolean;
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
    queryPerformers?: {
      count?: unknown;
      performers?: Array<{
        id?: unknown;
        name?: unknown;
        gender?: unknown;
        scene_count?: unknown;
        is_favorite?: unknown;
        images?: Array<{
          id?: unknown;
          url?: unknown;
          width?: unknown;
          height?: unknown;
        }>;
      }>;
    };
    queryStudios?: {
      studios?: Array<{
        id?: unknown;
        name?: unknown;
        child_studios?: Array<{
          id?: unknown;
          name?: unknown;
        }>;
      }>;
    };
    findPerformer?: {
      id?: unknown;
      name?: unknown;
      disambiguation?: unknown;
      aliases?: unknown;
      gender?: unknown;
      birth_date?: unknown;
      death_date?: unknown;
      age?: unknown;
      ethnicity?: unknown;
      country?: unknown;
      eye_color?: unknown;
      hair_color?: unknown;
      height?: unknown;
      cup_size?: unknown;
      band_size?: unknown;
      waist_size?: unknown;
      hip_size?: unknown;
      breast_type?: unknown;
      career_start_year?: unknown;
      career_end_year?: unknown;
      deleted?: unknown;
      merged_ids?: unknown;
      merged_into_id?: unknown;
      is_favorite?: unknown;
      created?: unknown;
      updated?: unknown;
      images?: Array<{
        id?: unknown;
        url?: unknown;
        width?: unknown;
        height?: unknown;
      }>;
    } | null;
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
    favoritePerformer?: unknown;
    favoriteStudio?: unknown;
  };
  errors?: Array<{
    message?: unknown;
    path?: unknown;
  }>;
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

  async getPerformersFeed(
    config: StashdbPerformerFeedConfig,
  ): Promise<StashdbPerformersFeedResult> {
    const normalizedName = config.name?.trim() ?? '';
    const sort = config.sort ?? 'NAME';
    const inputParts = [
      'per_page: $perPage',
      'page: $page',
      `sort: ${sort}`,
    ];

    if (normalizedName) {
      inputParts.push('name: $name');
    }

    if (config.gender) {
      inputParts.push(`gender: ${config.gender}`);
    }

    if (config.favoritesOnly) {
      inputParts.push('is_favorite: true');
    }

    const nameVariableDeclaration = normalizedName ? ', $name: String!' : '';
    const query = `
      query QueryPerformers($page: Int!, $perPage: Int!${nameVariableDeclaration}) {
        queryPerformers(input: { ${inputParts.join(', ')} }) {
          count
          performers {
            id
            name
            gender
            scene_count
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
    `;

    const variables: Record<string, unknown> = {
      page: config.page,
      perPage: config.perPage,
    };
    if (normalizedName) {
      variables.name = normalizedName;
    }

    const payload = await this.executeQuery(config, query, variables);
    const total =
      typeof payload.data?.queryPerformers?.count === 'number'
        ? payload.data.queryPerformers.count
        : 0;
    const rawPerformers = payload.data?.queryPerformers?.performers ?? [];

    const performers = rawPerformers
      .map((performer): StashdbPerformerFeedItem | null => {
        if (
          typeof performer.id !== 'string' ||
          typeof performer.name !== 'string'
        ) {
          return null;
        }

        return {
          id: performer.id,
          name: performer.name,
          gender: this.normalizePerformerGender(performer.gender),
          sceneCount:
            typeof performer.scene_count === 'number'
              ? performer.scene_count
              : 0,
          isFavorite: performer.is_favorite === true,
          imageUrl:
            this.selectPrimaryImage(this.normalizeImages(performer.images))
              ?.url ?? null,
        };
      })
      .filter(
        (performer): performer is StashdbPerformerFeedItem => performer !== null,
      );

    return {
      total,
      performers,
    };
  }

  async getPerformerById(
    performerId: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbPerformerDetails> {
    const query = `
      query FindPerformer($id: ID!) {
        findPerformer(id: $id) {
          id
          name
          disambiguation
          aliases
          gender
          birth_date
          death_date
          age
          ethnicity
          country
          eye_color
          hair_color
          height
          cup_size
          band_size
          waist_size
          hip_size
          breast_type
          career_start_year
          career_end_year
          deleted
          merged_ids
          merged_into_id
          is_favorite
          created
          updated
          images {
            id
            url
            width
            height
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, { id: performerId });
    const performer = payload.data?.findPerformer;

    if (!performer) {
      throw new NotFoundException(
        `Performer ${performerId} not found in StashDB.`,
      );
    }

    if (typeof performer.id !== 'string' || typeof performer.name !== 'string') {
      throw new BadGatewayException(
        'StashDB performer response is missing required fields.',
      );
    }

    const images = this.normalizeImages(performer.images);
    const primaryImage = this.selectPrimaryImage(images);

    return {
      id: performer.id,
      name: performer.name,
      disambiguation: this.normalizeOptionalString(performer.disambiguation),
      aliases: Array.isArray(performer.aliases)
        ? performer.aliases.filter(
            (alias): alias is string => typeof alias === 'string',
          )
        : [],
      gender: this.normalizePerformerGender(performer.gender),
      birthDate: this.normalizeOptionalString(performer.birth_date),
      deathDate: this.normalizeOptionalString(performer.death_date),
      age: typeof performer.age === 'number' ? performer.age : null,
      ethnicity: this.normalizeOptionalString(performer.ethnicity),
      country: this.normalizeOptionalString(performer.country),
      eyeColor: this.normalizeOptionalString(performer.eye_color),
      hairColor: this.normalizeOptionalString(performer.hair_color),
      height: this.normalizeOptionalString(performer.height),
      cupSize: this.normalizeOptionalString(performer.cup_size),
      bandSize: typeof performer.band_size === 'number' ? performer.band_size : null,
      waistSize:
        typeof performer.waist_size === 'number' ? performer.waist_size : null,
      hipSize: typeof performer.hip_size === 'number' ? performer.hip_size : null,
      breastType: this.normalizeOptionalString(performer.breast_type),
      careerStartYear:
        typeof performer.career_start_year === 'number'
          ? performer.career_start_year
          : null,
      careerEndYear:
        typeof performer.career_end_year === 'number'
          ? performer.career_end_year
          : null,
      deleted: performer.deleted === true,
      mergedIds: Array.isArray(performer.merged_ids)
        ? performer.merged_ids.filter(
            (mergedId): mergedId is string => typeof mergedId === 'string',
          )
        : [],
      mergedIntoId:
        typeof performer.merged_into_id === 'string'
          ? performer.merged_into_id
          : null,
      isFavorite: performer.is_favorite === true,
      createdAt: this.normalizeOptionalString(performer.created),
      updatedAt: this.normalizeOptionalString(performer.updated),
      imageUrl: primaryImage?.url ?? null,
      images,
    };
  }

  async searchStudios(
    queryText: string,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbStudioOption[]> {
    const query = `
      query QueryStudios($name: String!) {
        queryStudios(input: { name: $name }) {
          studios {
            name
            id
            child_studios {
              id
              name
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, { name: queryText });
    const rawStudios = payload.data?.queryStudios?.studios ?? [];

    return rawStudios
      .map((studio): StashdbStudioOption | null => {
        if (typeof studio.id !== 'string' || typeof studio.name !== 'string') {
          return null;
        }

        const childStudios = (studio.child_studios ?? [])
          .map((child): { id: string; name: string } | null => {
            if (typeof child.id !== 'string' || typeof child.name !== 'string') {
              return null;
            }

            return {
              id: child.id,
              name: child.name,
            };
          })
          .filter(
            (child): child is { id: string; name: string } => child !== null,
          );

        return {
          id: studio.id,
          name: studio.name,
          childStudios,
        };
      })
      .filter((studio): studio is StashdbStudioOption => studio !== null);
  }

  async getScenesForPerformer(
    config: StashdbPerformerScenesConfig,
  ): Promise<StashdbTrendingScenesResult> {
    const normalizedStudioIds = (config.studioIds ?? [])
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const normalizedTagIds = (config.tagIds ?? [])
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const studioIds = [...new Set(normalizedStudioIds)];
    const tagIds = [...new Set(normalizedTagIds)];

    const variableDeclarations = ['$page: Int!', '$perPage: Int!', '$performerId: [ID!]!'];
    const inputParts = [
      `sort: ${config.sort}`,
      'direction: DESC',
      'page: $page',
      'per_page: $perPage',
      'performers: { value: $performerId, modifier: INCLUDES }',
    ];

    if (studioIds.length > 0) {
      variableDeclarations.push('$studioIds: [ID!]!');
      inputParts.push('studios: { value: $studioIds, modifier: INCLUDES }');
    }

    if (tagIds.length > 0) {
      variableDeclarations.push('$tagIds: [ID!]!');
      inputParts.push('tags: { value: $tagIds, modifier: INCLUDES }');
    }

    if (config.onlyFavoriteStudios) {
      inputParts.push('favorites: STUDIO');
    }

    const query = `
      query QueryScenesForPerformer(${variableDeclarations.join(', ')}) {
        queryScenes(input: { ${inputParts.join(', ')} }) {
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
      performerId: [config.performerId],
    };
    if (studioIds.length > 0) {
      variables.studioIds = studioIds;
    }
    if (tagIds.length > 0) {
      variables.tagIds = tagIds;
    }

    const payload = await this.executeQuery(config, query, variables);
    const total =
      typeof payload.data?.queryScenes?.count === 'number'
        ? payload.data.queryScenes.count
        : 0;
    const scenes = this.normalizeSceneFeedItems(payload.data?.queryScenes?.scenes ?? []);

    return { total, scenes };
  }

  async favoritePerformer(
    performerId: string,
    favorite: boolean,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbFavoriteResult> {
    const query = `
      mutation FavoritePerformer($id: ID!) {
        favoritePerformer(id: $id, favorite: ${favorite ? 'true' : 'false'})
      }
    `;

    const payload = await this.executeQueryRaw(config, query, { id: performerId });
    return this.normalizeFavoriteMutationResult(
      payload,
      'favoritePerformer',
      'performer_favorites_unique_idx',
      favorite,
    );
  }

  async favoriteStudio(
    studioId: string,
    favorite: boolean,
    config: StashdbAdapterBaseConfig,
  ): Promise<StashdbFavoriteResult> {
    const query = `
      mutation FavoriteStudio($id: ID!) {
        favoriteStudio(id: $id, favorite: ${favorite ? 'true' : 'false'})
      }
    `;

    const payload = await this.executeQueryRaw(config, query, { id: studioId });
    return this.normalizeFavoriteMutationResult(
      payload,
      'favoriteStudio',
      'studio_favorites_unique_idx',
      favorite,
    );
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
    const studioIds =
      'studioIds' in config && config.studioIds
        ? [...new Set(config.studioIds.map((id) => id.trim()).filter(Boolean))]
        : [];
    const tagModifier =
      tagFilter?.mode === 'AND' ? 'INCLUDES_ALL' : 'INCLUDES';
    const tagVariableDeclaration = tagFilter ? ', $tagIds: [ID!]!' : '';
    const studioVariableDeclaration =
      studioIds.length > 0 ? ', $studioIds: [ID!]!' : '';
    const favoritesInput = favorites ? `, favorites: ${favorites}` : '';
    const tagInput = tagFilter
      ? `, tags: { value: $tagIds, modifier: ${tagModifier} }`
      : '';
    const studioInput =
      studioIds.length > 0
        ? ', studios: { value: $studioIds, modifier: INCLUDES }'
        : '';
    const query = `
      query QueryScenes($page: Int!, $perPage: Int!${tagVariableDeclaration}${studioVariableDeclaration}) {
        queryScenes(input: { sort: ${sort}, direction: DESC, page: $page, per_page: $perPage${favoritesInput}${tagInput}${studioInput} }) {
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
    if (studioIds.length > 0) {
      variables.studioIds = studioIds;
    }

    const payload = await this.executeQuery(config, query, variables);

    const total =
      typeof payload.data?.queryScenes?.count === 'number'
        ? payload.data.queryScenes.count
        : 0;
    const scenes = this.normalizeSceneFeedItems(payload.data?.queryScenes?.scenes ?? []);

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
      studioId:
        typeof scene.studio?.id === 'string' && scene.studio.id.length > 0
          ? scene.studio.id
          : null,
      studioIsFavorite: scene.studio?.is_favorite === true,
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

  private normalizePerformerGender(
    value: unknown,
  ): StashdbPerformerGender | null {
    if (
      value === 'MALE' ||
      value === 'FEMALE' ||
      value === 'UNKNOWN' ||
      value === 'TRANSGENDER_MALE' ||
      value === 'TRANSGENDER_FEMALE' ||
      value === 'INTERSEX' ||
      value === 'NON_BINARY'
    ) {
      return value;
    }

    return null;
  }

  private normalizeSceneFeedItems(
    rawScenes: Array<{
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
    }>,
  ): StashdbScene[] {
    return rawScenes
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
          studioId:
            typeof scene.studio?.id === 'string' &&
            scene.studio.id.length > 0
              ? scene.studio.id
              : null,
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
  }

  private normalizeOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeFavoriteMutationResult(
    payload: StashdbGraphqlResponse,
    mutationField: 'favoritePerformer' | 'favoriteStudio',
    duplicateConstraint: string,
    requestedFavorite: boolean,
  ): StashdbFavoriteResult {
    if (typeof payload.data?.[mutationField] === 'boolean') {
      return {
        favorited: requestedFavorite,
        alreadyFavorited: false,
      };
    }

    if (
      requestedFavorite &&
      payload.errors?.some((error) =>
        this.isDuplicateFavoriteError(error, mutationField, duplicateConstraint),
      )
    ) {
      return {
        favorited: true,
        alreadyFavorited: true,
      };
    }

    if (payload.errors && payload.errors.length > 0) {
      const firstError = payload.errors[0]?.message;
      const message =
        typeof firstError === 'string' && firstError.length > 0
          ? firstError
          : 'StashDB favorite mutation failed.';
      throw new BadGatewayException(message);
    }

    throw new BadGatewayException('StashDB favorite mutation returned an invalid response.');
  }

  private isDuplicateFavoriteError(
    error: { message?: unknown; path?: unknown },
    mutationField: 'favoritePerformer' | 'favoriteStudio',
    duplicateConstraint: string,
  ): boolean {
    const message =
      typeof error.message === 'string'
        ? error.message.toLowerCase()
        : '';
    const path = Array.isArray(error.path)
      ? error.path.filter((segment): segment is string => typeof segment === 'string')
      : [];

    return (
      path.includes(mutationField) &&
      message.includes('duplicate key value violates unique constraint') &&
      message.includes(duplicateConstraint.toLowerCase())
    );
  }

  private async executeQuery(
    config: StashdbAdapterBaseConfig,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<StashdbGraphqlResponse> {
    const payload = await this.executeQueryRaw(config, query, variables);

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

  private async executeQueryRaw(
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
