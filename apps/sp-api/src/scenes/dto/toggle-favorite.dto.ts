import { IsBoolean } from 'class-validator';

export class ToggleFavoriteDto {
  @IsBoolean()
  favorite!: boolean;
}
