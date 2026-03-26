import { SceneStatusDto } from '../../scene-status/dto/scene-status.dto';

export class ScenesFeedItemDto {
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
  source!: 'STASHDB';
  status!: SceneStatusDto;
  requestable!: boolean;
}

export class ScenesFeedResponseDto {
  total!: number | null;
  page!: number;
  perPage!: number;
  hasMore!: boolean;
  items!: ScenesFeedItemDto[];
}
