export type LibrarySceneSort =
  | 'CREATED_AT'
  | 'UPDATED_AT'
  | 'TITLE'
  | 'RELEASE_DATE';

export type LibrarySortDirection = 'ASC' | 'DESC';
export type LibraryTagMatchMode = 'OR' | 'AND';

export interface LibraryTagOption {
  id: string;
  name: string;
}

export interface LibraryStudioOption {
  id: string;
  name: string;
}

export interface LibrarySceneItem {
  id: string;
  activeCatalogSceneId: string | null;
  title: string;
  description: string | null;
  imageUrl: string | null;
  cardImageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
  performerNames: string[];
  releaseDate: string | null;
  duration: number | null;
  localCreatedAt: string | null;
  type: 'SCENE';
  source: 'STASH';
  viewUrl: string;
}

export interface LibraryScenesFeedResponse {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  latestSyncAt: string | null;
  items: LibrarySceneItem[];
}
