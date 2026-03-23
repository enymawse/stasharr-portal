export interface StudioFeedChildDto {
  id: string;
  name: string;
}

export interface StudioFeedItemDto {
  id: string;
  name: string;
  isFavorite: boolean;
  imageUrl: string | null;
  parentStudio: StudioFeedChildDto | null;
  childStudios: StudioFeedChildDto[];
}
