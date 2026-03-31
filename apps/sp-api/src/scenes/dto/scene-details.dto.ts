import { SceneStatusDto } from '../../scene-status/dto/scene-status.dto';
import { type CatalogProviderKey } from '../../providers/catalog/catalog-provider.util';

export class SceneImageDto {
  id!: string;
  url!: string;
  width!: number | null;
  height!: number | null;
}

export class SceneTagDto {
  id!: string;
  name!: string;
  description!: string | null;
}

export class ScenePerformerDto {
  id!: string;
  name!: string;
  gender!: string | null;
  isFavorite!: boolean;
  imageUrl!: string | null;
  cardImageUrl!: string | null;
}

export class SceneUrlDto {
  url!: string;
  type!: string | null;
}

export class SceneStashCopyDto {
  id!: string;
  viewUrl!: string;
  width!: number | null;
  height!: number | null;
  label!: string;
}

export class SceneStashAvailabilityDto {
  exists!: boolean;
  hasMultipleCopies!: boolean;
  copies!: SceneStashCopyDto[];
}

export class SceneWhisparrAvailabilityDto {
  exists!: boolean;
  viewUrl!: string;
}

export class SceneDetailsDto {
  id!: string;
  title!: string;
  description!: string | null;
  imageUrl!: string | null;
  images!: SceneImageDto[];
  studioId!: string | null;
  studioIsFavorite!: boolean;
  studio!: string | null;
  studioImageUrl!: string | null;
  studioUrl!: string | null;
  releaseDate!: string | null;
  duration!: number | null;
  tags!: SceneTagDto[];
  performers!: ScenePerformerDto[];
  sourceUrls!: SceneUrlDto[];
  source!: CatalogProviderKey;
  status!: SceneStatusDto;
  stash!: SceneStashAvailabilityDto | null;
  whisparr!: SceneWhisparrAvailabilityDto | null;
}
