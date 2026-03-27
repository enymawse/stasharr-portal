import { IsIn, IsOptional } from 'class-validator';
import { DiscoverQueryDto } from '../../discover/dto/discover-query.dto';

export const ACQUISITION_LIFECYCLE_VALUES = [
  'REQUESTED',
  'DOWNLOADING',
  'IMPORT_PENDING',
  'FAILED',
] as const;

export type AcquisitionLifecycle =
  (typeof ACQUISITION_LIFECYCLE_VALUES)[number];
export const ACQUISITION_LIFECYCLE_FILTER_VALUES = [
  'ANY',
  ...ACQUISITION_LIFECYCLE_VALUES,
] as const;
export type AcquisitionLifecycleFilter = 'ANY' | AcquisitionLifecycle;

export class AcquisitionScenesQueryDto extends DiscoverQueryDto {
  @IsOptional()
  @IsIn(ACQUISITION_LIFECYCLE_FILTER_VALUES)
  lifecycle?: AcquisitionLifecycleFilter;
}
