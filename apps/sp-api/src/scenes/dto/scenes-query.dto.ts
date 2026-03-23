import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { DiscoverQueryDto } from '../../discover/dto/discover-query.dto';

export const SCENE_FEED_SORT_VALUES = [
  'DATE',
  'TRENDING',
  'TITLE',
  'CREATED_AT',
  'UPDATED_AT',
] as const;

export type SceneFeedSort = (typeof SCENE_FEED_SORT_VALUES)[number];
export const SORT_DIRECTION_VALUES = ['ASC', 'DESC'] as const;
export type SortDirection = (typeof SORT_DIRECTION_VALUES)[number];

export const SCENE_TAG_MATCH_MODE_VALUES = ['OR', 'AND'] as const;
export type SceneTagMatchMode = (typeof SCENE_TAG_MATCH_MODE_VALUES)[number];
export const SCENE_FAVORITES_FILTER_VALUES = [
  'ALL',
  'PERFORMER',
  'STUDIO',
] as const;
export type SceneFavoritesFilter =
  (typeof SCENE_FAVORITES_FILTER_VALUES)[number];

export class ScenesQueryDto extends DiscoverQueryDto {
  @IsOptional()
  @IsIn(SCENE_FEED_SORT_VALUES)
  sort?: SceneFeedSort;

  @IsOptional()
  @IsIn(SORT_DIRECTION_VALUES)
  direction?: SortDirection;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return [];
    }

    const segments = Array.isArray(value) ? value : [value];
    return segments
      .flatMap((entry) =>
        typeof entry === 'string' ? entry.split(',') : [String(entry)],
      )
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  })
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return [];
    }

    const segments = Array.isArray(value) ? value : [value];
    return segments
      .flatMap((entry) =>
        typeof entry === 'string' ? entry.split(',') : [String(entry)],
      )
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  })
  @IsArray()
  @IsString({ each: true })
  studioIds?: string[];

  @IsOptional()
  @IsIn(SCENE_TAG_MATCH_MODE_VALUES)
  tagMode?: SceneTagMatchMode;

  @IsOptional()
  @IsIn(SCENE_FAVORITES_FILTER_VALUES)
  favorites?: SceneFavoritesFilter;
}
