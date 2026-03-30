export class LibrarySceneFeedItemDto {
  id!: string;
  linkedStashId!: string | null;
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
  source!: 'STASH';
  viewUrl!: string;
}

export class LibraryScenesFeedDto {
  total!: number;
  page!: number;
  perPage!: number;
  hasMore!: boolean;
  items!: LibrarySceneFeedItemDto[];
}
