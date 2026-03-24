export const HOME_RAIL_KEY_VALUES = [
  'FAVORITE_STUDIOS',
  'FAVORITE_PERFORMERS',
] as const;

export type HomeRailKey = (typeof HOME_RAIL_KEY_VALUES)[number];

export const HOME_RAIL_FAVORITES_VALUES = ['STUDIO', 'PERFORMER'] as const;
export type HomeRailFavorites = (typeof HOME_RAIL_FAVORITES_VALUES)[number];

export class HomeRailDto {
  key!: HomeRailKey;
  title!: string;
  subtitle!: string;
  enabled!: boolean;
  sortOrder!: number;
  favorites!: HomeRailFavorites;
}
