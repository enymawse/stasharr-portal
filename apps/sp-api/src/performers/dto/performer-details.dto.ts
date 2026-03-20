import { PerformerGender } from './performers-query.dto';

export interface PerformerDetailsImageDto {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface PerformerDetailsDto {
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
  images: PerformerDetailsImageDto[];
}
