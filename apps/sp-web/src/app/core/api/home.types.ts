import {
  SceneStatus,
  SceneFavoritesFilter,
  SceneFeedSort,
  SceneTagMatchMode,
  SceneTagOption,
  SortDirection,
} from './discover.types';

export type HomeRailKey =
  | 'FAVORITE_STUDIOS'
  | 'FAVORITE_PERFORMERS'
  | 'RECENTLY_ADDED_LIBRARY';
export type HomeRailKind = 'BUILTIN' | 'CUSTOM';
export type HomeRailSource = 'STASHDB' | 'STASH';
export type HomeRailContentType = 'SCENES';
export type HomeStashSceneSort = 'CREATED_AT' | 'UPDATED_AT' | 'TITLE';

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
  | BaseHomeRailConfig<'STASH', HomeStashSceneRailConfig>;

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
  source: HomeRailSource;
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
  config: HomeStashdbSceneRailConfig | HomeStashSceneRailConfig;
}

export interface HomeRailFormDraft {
  source: HomeRailSource;
  title: string;
  subtitle: string;
  enabled: boolean;
  sort: SceneFeedSort;
  direction: SortDirection;
  favorites: SceneFavoritesFilter | 'NONE';
  tagMode: SceneTagMatchMode;
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
  tagCount: number;
  studioCount: number;
  limit: number;
}
