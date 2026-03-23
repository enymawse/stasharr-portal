export interface StudioDetailsImageDto {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface StudioDetailsUrlDto {
  url: string;
  type: string | null;
  siteName: string | null;
  siteUrl: string | null;
  siteIcon: string | null;
}

export interface StudioDetailsParentDto {
  id: string;
  name: string;
  aliases: string[];
  isFavorite: boolean;
  urls: StudioDetailsUrlDto[];
}

export interface StudioDetailsChildDto {
  id: string;
  name: string;
  aliases: string[];
  deleted: boolean;
  isFavorite: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  imageUrl: string | null;
}

export interface StudioDetailsDto {
  id: string;
  name: string;
  aliases: string[];
  deleted: boolean;
  isFavorite: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  imageUrl: string | null;
  images: StudioDetailsImageDto[];
  urls: StudioDetailsUrlDto[];
  parentStudio: StudioDetailsParentDto | null;
  childStudios: StudioDetailsChildDto[];
}
