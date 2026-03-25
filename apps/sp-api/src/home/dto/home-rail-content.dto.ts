import { SceneStatusDto } from '../../scene-status/dto/scene-status.dto';
import { HOME_RAIL_SOURCE_VALUES, type HomeRailSource } from './home-rail.dto';

export class HomeRailItemDto {
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
  source!: HomeRailSource;
  status!: SceneStatusDto;
  requestable!: boolean;
  viewUrl!: string | null;
}

export class HomeRailContentDto {
  items!: HomeRailItemDto[];
  message!: string | null;
}

export { HOME_RAIL_SOURCE_VALUES };
