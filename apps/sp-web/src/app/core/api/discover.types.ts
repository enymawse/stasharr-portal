export type SceneStatusState =
  | 'NOT_REQUESTED'
  | 'DOWNLOADING'
  | 'AVAILABLE'
  | 'MISSING';

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

export type SceneFeedSort =
  | 'DATE'
  | 'TRENDING'
  | 'TITLE'
  | 'CREATED_AT'
  | 'UPDATED_AT';

export type SceneTagMatchMode = 'OR' | 'AND';
export type SceneFavoritesFilter = 'ALL' | 'PERFORMER' | 'STUDIO';

export interface SceneTagOption {
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
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

export interface SceneRequestOptionsRootFolder {
  id: number;
  path: string;
  accessible: boolean;
}

export interface SceneRequestOptionsQualityProfile {
  id: number;
  name: string;
}

export interface SceneRequestOptionsTag {
  id: number;
  label: string;
}

export interface SceneRequestOptions {
  scene: {
    stashId: string;
    title: string;
    studio: string | null;
  };
  defaults: {
    monitored: boolean;
    searchForMovie: boolean;
  };
  rootFolders: SceneRequestOptionsRootFolder[];
  qualityProfiles: SceneRequestOptionsQualityProfile[];
  tags: SceneRequestOptionsTag[];
}

export interface SubmitSceneRequestPayload {
  monitored: boolean;
  rootFolderPath: string;
  searchForMovie: boolean;
  qualityProfileId: number;
  tags: number[];
}

export interface SubmitSceneRequestResponse {
  accepted: boolean;
  alreadyExists: boolean;
  stashId: string;
  whisparrMovieId: number | null;
}

export interface SceneRequestContext {
  id: string;
  title: string;
  imageUrl: string | null;
}
