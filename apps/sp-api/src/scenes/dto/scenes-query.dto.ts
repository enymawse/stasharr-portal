import { IsIn, IsOptional } from 'class-validator';
import { DiscoverQueryDto } from '../../discover/dto/discover-query.dto';

export const SCENE_FEED_SORT_VALUES = [
  'DATE',
  'TRENDING',
  'TITLE',
  'CREATED_AT',
  'UPDATED_AT',
] as const;

export type SceneFeedSort = (typeof SCENE_FEED_SORT_VALUES)[number];

export class ScenesQueryDto extends DiscoverQueryDto {
  @IsOptional()
  @IsIn(SCENE_FEED_SORT_VALUES)
  sort?: SceneFeedSort;
}
