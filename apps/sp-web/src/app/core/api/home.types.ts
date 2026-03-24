export type HomeRailKey = 'FAVORITE_STUDIOS' | 'FAVORITE_PERFORMERS';
export type HomeRailFavorites = 'STUDIO' | 'PERFORMER';

export interface HomeRailConfig {
  key: HomeRailKey;
  title: string;
  subtitle: string;
  enabled: boolean;
  sortOrder: number;
  favorites: HomeRailFavorites;
}

export interface UpdateHomeRailsPayload {
  rails: Array<{
    key: HomeRailKey;
    enabled: boolean;
  }>;
}
