import { SceneStatusDto } from '../../scene-status/dto/scene-status.dto';

export class DiscoverItemDto {
  id!: string;
  title!: string;
  description!: string | null;
  imageUrl!: string | null;
  studioId!: string | null;
  studio!: string | null;
  studioImageUrl!: string | null;
  releaseDate!: string | null;
  duration!: number | null;
  type!: 'SCENE';
  source!: 'STASHDB';
  status!: SceneStatusDto;
}

export class DiscoverResponseDto {
  total!: number;
  page!: number;
  perPage!: number;
  hasMore!: boolean;
  items!: DiscoverItemDto[];
}
