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
}

export class SceneUrlDto {
  url!: string;
  type!: string | null;
}

export class SceneDetailsDto {
  id!: string;
  title!: string;
  description!: string | null;
  imageUrl!: string | null;
  images!: SceneImageDto[];
  studio!: string | null;
  releaseDate!: string | null;
  duration!: number | null;
  tags!: SceneTagDto[];
  performers!: ScenePerformerDto[];
  sourceUrls!: SceneUrlDto[];
  source!: 'STASHDB';
}
