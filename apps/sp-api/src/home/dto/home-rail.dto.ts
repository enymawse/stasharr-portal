import {
  SCENE_FAVORITES_FILTER_VALUES,
  SCENE_FEED_SORT_VALUES,
  SCENE_TAG_MATCH_MODE_VALUES,
  SORT_DIRECTION_VALUES,
  type SceneFavoritesFilter,
  type SceneFeedSort,
  type SceneTagMatchMode,
  type SortDirection,
} from '../../scenes/dto/scenes-query.dto';

export const HOME_RAIL_KEY_VALUES = [
  'FAVORITE_STUDIOS',
  'FAVORITE_PERFORMERS',
  'RECENTLY_ADDED_LIBRARY',
] as const;
export type HomeRailKey = (typeof HOME_RAIL_KEY_VALUES)[number];

export const HOME_RAIL_KIND_VALUES = ['BUILTIN', 'CUSTOM'] as const;
export type HomeRailKind = (typeof HOME_RAIL_KIND_VALUES)[number];

export const HOME_RAIL_SOURCE_VALUES = ['STASHDB', 'STASH', 'HYBRID'] as const;
export type HomeRailSource = (typeof HOME_RAIL_SOURCE_VALUES)[number];

export const HOME_RAIL_CONTENT_TYPE_VALUES = ['SCENES'] as const;
export type HomeRailContentType = (typeof HOME_RAIL_CONTENT_TYPE_VALUES)[number];

export const HOME_RAIL_SCENE_LIMIT_MIN = 6;
export const HOME_RAIL_SCENE_LIMIT_MAX = 30;
export const HOME_RAIL_SCENE_LIMIT_DEFAULT = 16;

export const HOME_RAIL_STASHDB_SCENE_SORT_VALUES = SCENE_FEED_SORT_VALUES;
export const HOME_RAIL_STASH_SCENE_SORT_VALUES = [
  'CREATED_AT',
  'UPDATED_AT',
  'TITLE',
] as const;
export const HOME_RAIL_DIRECTION_VALUES = SORT_DIRECTION_VALUES;
export const HOME_RAIL_FAVORITES_VALUES = SCENE_FAVORITES_FILTER_VALUES;
export const HOME_RAIL_TAG_MODE_VALUES = SCENE_TAG_MATCH_MODE_VALUES;

export type HomeRailStashdbSceneSort = SceneFeedSort;
export type HomeRailStashSceneSort = (typeof HOME_RAIL_STASH_SCENE_SORT_VALUES)[number];
export type HomeRailDirection = SortDirection;
export type HomeRailFavorites = SceneFavoritesFilter;
export type HomeRailTagMode = SceneTagMatchMode;
export const HOME_RAIL_LIBRARY_AVAILABILITY_VALUES = [
  'IN_LIBRARY',
  'MISSING_FROM_LIBRARY',
] as const;
export type HomeRailLibraryAvailability =
  (typeof HOME_RAIL_LIBRARY_AVAILABILITY_VALUES)[number];

export class HomeRailStashdbSceneConfigDto {
  sort!: HomeRailStashdbSceneSort;
  direction!: HomeRailDirection;
  favorites!: HomeRailFavorites | null;
  tagIds!: string[];
  tagNames!: string[];
  tagMode!: HomeRailTagMode | null;
  studioIds!: string[];
  studioNames!: string[];
  limit!: number;
}

export class HomeRailStashSceneConfigDto {
  sort!: HomeRailStashSceneSort;
  direction!: HomeRailDirection;
  titleQuery!: string | null;
  tagIds!: string[];
  tagNames!: string[];
  tagMode!: HomeRailTagMode | null;
  studioIds!: string[];
  studioNames!: string[];
  favoritePerformersOnly!: boolean;
  favoriteStudiosOnly!: boolean;
  limit!: number;
}

export class HomeRailHybridSceneConfigDto {
  sort!: HomeRailStashdbSceneSort;
  direction!: HomeRailDirection;
  stashdbFavorites!: HomeRailFavorites | null;
  tagIds!: string[];
  tagNames!: string[];
  tagMode!: HomeRailTagMode | null;
  studioIds!: string[];
  studioNames!: string[];
  libraryAvailability!: HomeRailLibraryAvailability;
  limit!: number;
}

export type HomeRailSceneConfigDto =
  | HomeRailStashdbSceneConfigDto
  | HomeRailStashSceneConfigDto
  | HomeRailHybridSceneConfigDto;

export class HomeRailDto {
  id!: string;
  key!: HomeRailKey | null;
  kind!: HomeRailKind;
  source!: HomeRailSource;
  contentType!: HomeRailContentType;
  title!: string;
  subtitle!: string | null;
  enabled!: boolean;
  sortOrder!: number;
  editable!: boolean;
  deletable!: boolean;
  config!: HomeRailSceneConfigDto;
}
