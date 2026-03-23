import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DiscoverQueryDto } from '../../discover/dto/discover-query.dto';

export const STUDIO_SORT_VALUES = ['NAME', 'CREATED_AT', 'UPDATED_AT'] as const;
export type StudioSort = (typeof STUDIO_SORT_VALUES)[number];
export const STUDIO_SORT_DIRECTION_VALUES = ['ASC', 'DESC'] as const;
export type StudioSortDirection = (typeof STUDIO_SORT_DIRECTION_VALUES)[number];

export class StudiosQueryDto extends DiscoverQueryDto {
  @IsOptional()
  @IsIn(STUDIO_SORT_VALUES)
  sort?: StudioSort;

  @IsOptional()
  @IsIn(STUDIO_SORT_DIRECTION_VALUES)
  direction?: StudioSortDirection;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

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
      if (normalized === '1') {
        return true;
      }
      if (normalized === '0') {
        return false;
      }
    }

    return value;
  })
  @IsBoolean()
  favoritesOnly?: boolean;
}
