export interface DiscoverItem {
  id: string;
  title: string;
  type: 'SCENE';
  imageUrl: string | null;
  studio: string | null;
  releaseDate: string | null;
  source: 'STASHDB';
  sourceUrl: string | null;
}
