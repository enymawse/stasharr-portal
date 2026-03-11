export type SceneStatusState =
  | 'UNREQUESTED'
  | 'REQUESTED'
  | 'PROCESSING'
  | 'AVAILABLE'
  | 'FAILED';

export interface SceneStatus {
  state: SceneStatusState;
}

export interface DiscoverItem {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  releaseDate: string | null;
  duration: number | null;
  type: 'SCENE';
  source: 'STASHDB';
  status: SceneStatus;
}

export interface DiscoverResponse {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: DiscoverItem[];
}

export interface SceneImage {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface SceneTag {
  id: string;
  name: string;
  description: string | null;
}

export interface ScenePerformer {
  id: string;
  name: string;
  gender: string | null;
  isFavorite: boolean;
  imageUrl: string | null;
}

export interface SceneUrl {
  url: string;
  type: string | null;
}

export interface SceneStashCopy {
  id: string;
  viewUrl: string;
  width: number | null;
  height: number | null;
  label: string;
}

export interface SceneStashAvailability {
  exists: boolean;
  hasMultipleCopies: boolean;
  copies: SceneStashCopy[];
}

export interface SceneWhisparrAvailability {
  exists: boolean;
  viewUrl: string;
}

export interface SceneDetails {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  images: SceneImage[];
  studio: string | null;
  studioImageUrl: string | null;
  studioUrl: string | null;
  releaseDate: string | null;
  duration: number | null;
  tags: SceneTag[];
  performers: ScenePerformer[];
  sourceUrls: SceneUrl[];
  source: 'STASHDB';
  status: SceneStatus;
  stash: SceneStashAvailability | null;
  whisparr: SceneWhisparrAvailability | null;
}
