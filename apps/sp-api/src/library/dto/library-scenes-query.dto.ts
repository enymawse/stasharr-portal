import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import { DiscoverQueryDto } from '../../discover/dto/discover-query.dto';

export const LIBRARY_SCENE_SORT_VALUES = [
  'CREATED_AT',
  'UPDATED_AT',
  'TITLE',
  'RELEASE_DATE',
] as const;
export type LibrarySceneSort = (typeof LIBRARY_SCENE_SORT_VALUES)[number];

export const LIBRARY_SORT_DIRECTION_VALUES = ['ASC', 'DESC'] as const;
export type LibrarySortDirection =
  (typeof LIBRARY_SORT_DIRECTION_VALUES)[number];

export const LIBRARY_TAG_MATCH_MODE_VALUES = ['OR', 'AND'] as const;
export type LibraryTagMatchMode =
  (typeof LIBRARY_TAG_MATCH_MODE_VALUES)[number];

function parseStringArray(value: unknown): string[] {
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
}

export class LibraryScenesQueryDto extends DiscoverQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : undefined,
  )
  @IsString()
  query?: string;

  @IsOptional()
  @IsIn(LIBRARY_SCENE_SORT_VALUES)
  sort?: LibrarySceneSort;

  @IsOptional()
  @IsIn(LIBRARY_SORT_DIRECTION_VALUES)
  direction?: LibrarySortDirection;

  @IsOptional()
  @Transform(({ value }) => parseStringArray(value))
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsIn(LIBRARY_TAG_MATCH_MODE_VALUES)
  tagMode?: LibraryTagMatchMode;

  @IsOptional()
  @Transform(({ value }) => parseStringArray(value))
  @IsArray()
  @IsString({ each: true })
  studioIds?: string[];

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  favoritePerformersOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  favoriteStudiosOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  favoriteTagsOnly?: boolean;
}
