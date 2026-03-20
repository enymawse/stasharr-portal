import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PERFORMER_SORT_VALUES = [
  'NAME',
  'BIRTHDATE',
  'DEATHDATE',
  'SCENE_COUNT',
  'CAREER_START_YEAR',
  'DEBUT',
  'LAST_SCENE',
  'CREATED_AT',
  'UPDATED_AT',
] as const;
export type PerformerSort = (typeof PERFORMER_SORT_VALUES)[number];

export const PERFORMER_GENDER_VALUES = [
  'MALE',
  'FEMALE',
  'UNKNOWN',
  'TRANSGENDER_MALE',
  'TRANSGENDER_FEMALE',
  'INTERSEX',
  'NON_BINARY',
] as const;
export type PerformerGender = (typeof PERFORMER_GENDER_VALUES)[number];

export class PerformersQueryDto {
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
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(PERFORMER_GENDER_VALUES)
  gender?: PerformerGender;

  @IsOptional()
  @IsIn(PERFORMER_SORT_VALUES)
  sort?: PerformerSort;

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
  favoritesOnly?: boolean;

}
