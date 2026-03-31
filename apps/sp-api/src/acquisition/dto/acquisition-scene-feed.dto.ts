import { SceneStatusDto } from '../../scene-status/dto/scene-status.dto';
import { type CatalogProviderKey } from '../../providers/catalog/catalog-provider.util';

export class AcquisitionCountsByLifecycleDto {
  REQUESTED!: number;
  DOWNLOADING!: number;
  IMPORT_PENDING!: number;
  FAILED!: number;
}

export class AcquisitionSceneItemDto {
  id!: string;
  title!: string;
  description!: string | null;
  imageUrl!: string | null;
  cardImageUrl!: string | null;
  studioId!: string | null;
  studio!: string | null;
  studioImageUrl!: string | null;
  releaseDate!: string | null;
  duration!: number | null;
  type!: 'SCENE';
  source!: CatalogProviderKey;
  status!: SceneStatusDto;
  whisparrViewUrl!: string | null;
}

export class AcquisitionScenesFeedDto {
  total!: number;
  page!: number;
  perPage!: number;
  hasMore!: boolean;
  countsByLifecycle!: AcquisitionCountsByLifecycleDto;
  items!: AcquisitionSceneItemDto[];
}
