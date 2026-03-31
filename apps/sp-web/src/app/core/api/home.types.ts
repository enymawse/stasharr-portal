import {
  SceneStatus,
  SceneFavoritesFilter,
  SceneFeedSort,
  SceneTagMatchMode,
  SceneTagOption,
  SortDirection,
} from './discover.types';
import { CatalogProviderType } from './integrations.types';

export type HomeRailKey =
  | 'FAVORITE_STUDIOS'
  | 'FAVORITE_PERFORMERS'
  | 'RECENTLY_ADDED_LIBRARY';
export type HomeRailKind = 'BUILTIN' | 'CUSTOM';
export type HomeRailSource = 'STASHDB' | 'STASH' | 'HYBRID';
export type HomeRailItemSource = HomeRailSource | CatalogProviderType;
export type HomeRailContentType = 'SCENES';
export type HomeStashSceneSort = 'CREATED_AT' | 'UPDATED_AT' | 'TITLE';
export type HomeHybridLibraryAvailability = 'IN_LIBRARY' | 'MISSING_FROM_LIBRARY';

export interface HomeStashdbSceneRailConfig {
  sort: SceneFeedSort;
  direction: SortDirection;
  favorites: SceneFavoritesFilter | null;
  tagIds: string[];
  tagNames: string[];
  tagMode: SceneTagMatchMode | null;
  studioIds: string[];
  studioNames: string[];
  limit: number;
}

export interface HomeStashSceneRailConfig {
  sort: HomeStashSceneSort;
  direction: SortDirection;
  titleQuery: string | null;
  tagIds: string[];
  tagNames: string[];
  tagMode: SceneTagMatchMode | null;
  studioIds: string[];
  studioNames: string[];
  favoritePerformersOnly: boolean;
  favoriteStudiosOnly: boolean;
  favoriteTagsOnly: boolean;
  limit: number;
}

export interface HomeHybridSceneRailConfig {
  sort: SceneFeedSort;
  direction: SortDirection;
  stashdbFavorites: SceneFavoritesFilter | null;
  tagIds: string[];
  tagNames: string[];
  tagMode: SceneTagMatchMode | null;
  studioIds: string[];
  studioNames: string[];
  stashFavoritePerformersOnly: boolean;
  stashFavoriteStudiosOnly: boolean;
  stashFavoriteTagsOnly: boolean;
  libraryAvailability: HomeHybridLibraryAvailability;
  limit: number;
}

interface BaseHomeRailConfig<TSource extends HomeRailSource, TConfig> {
  id: string;
  key: HomeRailKey | null;
  kind: HomeRailKind;
  source: TSource;
  contentType: HomeRailContentType;
  title: string;
  subtitle: string | null;
  enabled: boolean;
  sortOrder: number;
  editable: boolean;
  deletable: boolean;
  config: TConfig;
}

export type HomeRailConfig =
  | BaseHomeRailConfig<'STASHDB', HomeStashdbSceneRailConfig>
  | BaseHomeRailConfig<'STASH', HomeStashSceneRailConfig>
  | BaseHomeRailConfig<'HYBRID', HomeHybridSceneRailConfig>;

export interface HomeRailItem {
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
  type: 'SCENE';
  source: HomeRailItemSource;
  status: SceneStatus;
  requestable: boolean;
  viewUrl: string | null;
}

export interface HomeRailContentResponse {
  items: HomeRailItem[];
  message: string | null;
}

export interface UpdateHomeRailsPayload {
  rails: Array<{
    id: string;
    enabled: boolean;
  }>;
}

export interface SaveHomeRailPayload {
  source: HomeRailSource;
  title: string;
  subtitle: string | null;
  enabled: boolean;
  config: HomeStashdbSceneRailConfig | HomeStashSceneRailConfig | HomeHybridSceneRailConfig;
}

export interface HomeRailFormDraft {
  source: HomeRailSource;
  title: string;
  subtitle: string;
  enabled: boolean;
  sort: SceneFeedSort | HomeStashSceneSort;
  direction: SortDirection;
  titleQuery: string;
  favorites: SceneFavoritesFilter | 'NONE';
  stashdbFavorites: SceneFavoritesFilter | 'NONE';
  tagMode: SceneTagMatchMode;
  favoritePerformersOnly: boolean;
  favoriteStudiosOnly: boolean;
  favoriteTagsOnly: boolean;
  stashFavoritePerformersOnly: boolean;
  stashFavoriteStudiosOnly: boolean;
  stashFavoriteTagsOnly: boolean;
  libraryAvailability: HomeHybridLibraryAvailability;
  limit: number;
  selectedTags: SceneTagOption[];
  selectedStudios: Array<{
    id: string;
    label: string;
  }>;
}

export interface HomeRailViewSummary {
  sortLabel: string;
  favoritesLabel: string;
  stashLocalFavoritesLabel: string | null;
  titleQueryLabel: string | null;
  libraryAvailabilityLabel: string | null;
  tagCount: number;
  studioCount: number;
  limit: number;
}
