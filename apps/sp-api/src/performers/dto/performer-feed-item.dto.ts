import { PerformerGender } from './performers-query.dto';

export interface PerformerFeedItemDto {
  id: string;
  name: string;
  gender: PerformerGender | null;
  sceneCount: number;
  isFavorite: boolean;
  imageUrl: string | null;
}
