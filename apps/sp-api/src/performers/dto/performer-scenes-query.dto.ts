import { Transform, Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const PERFORMER_SCENES_SORT_VALUES = [
  'TITLE',
  'DATE',
  'TRENDING',
  'CREATED_AT',
  'UPDATED_AT',
] as const;

export type PerformerScenesSort = (typeof PERFORMER_SCENES_SORT_VALUES)[number];

export class PerformerScenesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  perPage?: number;

  @IsOptional()
  @IsIn(PERFORMER_SCENES_SORT_VALUES)
  sort?: PerformerScenesSort;

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
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return value;
  })
  @IsBoolean()
  onlyFavoriteStudios?: boolean;
}
