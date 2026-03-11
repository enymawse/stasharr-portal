export interface DiscoverItem {
  id: string;
  title: string;
  type: 'SCENE';
  details: string | null;
  imageUrl: string | null;
  imageCount: number;
  studioName: string | null;
  releaseDate: string | null;
  productionDate: string | null;
  duration: number | null;
  source: 'STASHDB';
  sourceUrl: string | null;
}
