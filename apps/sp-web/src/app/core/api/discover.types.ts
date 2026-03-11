export interface DiscoverItem {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  studio: string | null;
  releaseDate: string | null;
  duration: number | null;
  type: 'SCENE';
  source: 'STASHDB';
}

export interface DiscoverResponse {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  items: DiscoverItem[];
}
