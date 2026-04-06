import type {
  HomeRailDirection,
  HomeRailFavorites,
  HomeRailStashdbSceneSort,
  HomeRailTagMode,
} from './dto/home-rail.dto';

export const LEGACY_HOME_RAIL_LIBRARY_AVAILABILITY_VALUES = [
  'IN_LIBRARY',
  'MISSING_FROM_LIBRARY',
] as const;

export type LegacyHomeRailLibraryAvailability =
  (typeof LEGACY_HOME_RAIL_LIBRARY_AVAILABILITY_VALUES)[number];

export interface LegacyHomeRailHybridSceneConfig {
  sort: HomeRailStashdbSceneSort;
  direction: HomeRailDirection;
  stashdbFavorites: HomeRailFavorites | null;
  tagIds: string[];
  tagNames: string[];
  tagMode: HomeRailTagMode | null;
  studioIds: string[];
  studioNames: string[];
  stashFavoritePerformersOnly: boolean;
  stashFavoriteStudiosOnly: boolean;
  stashFavoriteTagsOnly: boolean;
  libraryAvailability: LegacyHomeRailLibraryAvailability;
  limit: number;
}
