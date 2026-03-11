export class DiscoverItemDto {
  id!: string;
  title!: string;
  description!: string | null;
  imageUrl!: string | null;
  studio!: string | null;
  releaseDate!: string | null;
  duration!: number | null;
  type!: 'SCENE';
  source!: 'STASHDB';
}

export class DiscoverResponseDto {
  total!: number;
  items!: DiscoverItemDto[];
}
