import {
  SceneFavoritesFilter,
  SceneFeedSort,
  SceneTagMatchMode,
  SceneTagOption,
  SortDirection,
} from './discover.types';

export type HomeRailKey = 'FAVORITE_STUDIOS' | 'FAVORITE_PERFORMERS';
export type HomeRailKind = 'BUILTIN' | 'CUSTOM';
export type HomeRailSource = 'STASHDB';
export type HomeRailContentType = 'SCENES';

export interface HomeSceneRailConfig {
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

export interface HomeRailConfig {
  id: string;
  key: HomeRailKey | null;
  kind: HomeRailKind;
  source: HomeRailSource;
  contentType: HomeRailContentType;
  title: string;
  subtitle: string | null;
  enabled: boolean;
  sortOrder: number;
  editable: boolean;
  deletable: boolean;
  config: HomeSceneRailConfig;
}

export interface UpdateHomeRailsPayload {
  rails: Array<{
    id: string;
    enabled: boolean;
  }>;
}

export interface SaveHomeRailPayload {
  title: string;
  subtitle: string | null;
  enabled: boolean;
  config: HomeSceneRailConfig;
}

export interface HomeRailFormDraft {
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
