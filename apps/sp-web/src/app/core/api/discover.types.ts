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
  cardImageUrl: string | null;
  studioId: string | null;
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
export type SortDirection = 'ASC' | 'DESC';

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
  cardImageUrl: string | null;
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
  studioId: string | null;
  studioIsFavorite: boolean;
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

export interface FavoriteMutationResponse {
  favorited: boolean;
  alreadyFavorited: boolean;
}

export interface SceneRequestContext {
  id: string;
  title: string;
  imageUrl: string | null;
}

export type PerformerSort =
  | 'NAME'
  | 'BIRTHDATE'
  | 'SCENE_COUNT'
  | 'CAREER_START_YEAR'
  | 'DEBUT'
  | 'LAST_SCENE'
  | 'CREATED_AT'
  | 'UPDATED_AT';

export type PerformerGender =
  | 'MALE'
  | 'FEMALE'
  | 'UNKNOWN'
  | 'TRANSGENDER_MALE'
  | 'TRANSGENDER_FEMALE'
  | 'INTERSEX'
  | 'NON_BINARY';

export interface PerformerFeedItem {
  id: string;
  name: string;
  gender: PerformerGender | null;
  sceneCount: number;
  isFavorite: boolean;
  imageUrl: string | null;
  cardImageUrl: string | null;
}

export interface PerformerFeedResponse {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: PerformerFeedItem[];
}

export interface PerformerDetailsImage {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface PerformerDetails {
  id: string;
  name: string;
  disambiguation: string | null;
  aliases: string[];
  gender: PerformerGender | null;
  birthDate: string | null;
  deathDate: string | null;
  age: number | null;
  ethnicity: string | null;
  country: string | null;
  eyeColor: string | null;
  hairColor: string | null;
  height: string | null;
  cupSize: string | null;
  bandSize: number | null;
  waistSize: number | null;
  hipSize: number | null;
  breastType: string | null;
  careerStartYear: number | null;
  careerEndYear: number | null;
  deleted: boolean;
  mergedIds: string[];
  mergedIntoId: string | null;
  isFavorite: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  imageUrl: string | null;
  images: PerformerDetailsImage[];
}

export interface PerformerStudioOption {
  id: string;
  name: string;
  childStudios: Array<{
    id: string;
    name: string;
  }>;
}

export type StudioFeedSort = 'NAME' | 'CREATED_AT' | 'UPDATED_AT';

export interface StudioFeedChild {
  id: string;
  name: string;
}

export interface StudioFeedItem {
  id: string;
  name: string;
  isFavorite: boolean;
  imageUrl: string | null;
  parentStudio: StudioFeedChild | null;
  childStudios: StudioFeedChild[];
}

export interface StudioFeedResponse {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: StudioFeedItem[];
}

export interface StudioDetailsImage {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface StudioDetailsUrl {
  url: string;
  type: string | null;
  siteName: string | null;
  siteUrl: string | null;
  siteIcon: string | null;
}

export interface StudioDetailsParent {
  id: string;
  name: string;
  aliases: string[];
  isFavorite: boolean;
  urls: StudioDetailsUrl[];
}

export interface StudioDetailsChild {
  id: string;
  name: string;
  aliases: string[];
  deleted: boolean;
  isFavorite: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  imageUrl: string | null;
}

export interface StudioDetails {
  id: string;
  name: string;
  aliases: string[];
  deleted: boolean;
  isFavorite: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  imageUrl: string | null;
  images: StudioDetailsImage[];
  urls: StudioDetailsUrl[];
  parentStudio: StudioDetailsParent | null;
  childStudios: StudioDetailsChild[];
}
