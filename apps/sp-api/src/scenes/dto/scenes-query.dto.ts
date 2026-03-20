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
  @IsIn(SCENE_TAG_MATCH_MODE_VALUES)
  tagMode?: SceneTagMatchMode;

  @IsOptional()
  @IsIn(SCENE_FAVORITES_FILTER_VALUES)
  favorites?: SceneFavoritesFilter;
}
