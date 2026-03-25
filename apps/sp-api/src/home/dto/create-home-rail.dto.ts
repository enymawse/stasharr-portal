import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  HOME_RAIL_DIRECTION_VALUES,
  HOME_RAIL_FAVORITES_VALUES,
  HOME_RAIL_SCENE_LIMIT_DEFAULT,
  HOME_RAIL_SCENE_LIMIT_MAX,
  HOME_RAIL_SCENE_LIMIT_MIN,
  HOME_RAIL_SOURCE_VALUES,
  HOME_RAIL_TAG_MODE_VALUES,
  type HomeRailDirection,
  type HomeRailFavorites,
  type HomeRailSource,
  type HomeRailStashSceneSort,
  type HomeRailStashdbSceneSort,
  type HomeRailTagMode,
} from './home-rail.dto';

class HomeRailSceneConfigInputDto {
  @IsString()
  @IsNotEmpty()
  sort!: HomeRailStashdbSceneSort | HomeRailStashSceneSort;

  @IsIn(HOME_RAIL_DIRECTION_VALUES)
  direction!: HomeRailDirection;

  @IsOptional()
  @IsIn(HOME_RAIL_FAVORITES_VALUES)
  favorites?: HomeRailFavorites | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagNames?: string[];

  @IsOptional()
  @IsIn(HOME_RAIL_TAG_MODE_VALUES)
  tagMode?: HomeRailTagMode | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studioIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studioNames?: string[];

  @Type(() => Number)
  @IsInt()
  @Min(HOME_RAIL_SCENE_LIMIT_MIN)
  @Max(HOME_RAIL_SCENE_LIMIT_MAX)
  limit: number = HOME_RAIL_SCENE_LIMIT_DEFAULT;
}

export class CreateHomeRailDto {
  @IsIn(HOME_RAIL_SOURCE_VALUES)
  source!: HomeRailSource;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  subtitle?: string | null;

  @Type(() => Boolean)
  @IsBoolean()
  enabled = true;

  @ValidateNested()
  @Type(() => HomeRailSceneConfigInputDto)
  config!: HomeRailSceneConfigInputDto;
}

export class UpdateHomeRailDto {
  @IsIn(HOME_RAIL_SOURCE_VALUES)
  source!: HomeRailSource;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsOptional()
  @IsString()
  subtitle?: string | null;

  @Type(() => Boolean)
  @IsBoolean()
  enabled!: boolean;

  @ValidateNested()
  @Type(() => HomeRailSceneConfigInputDto)
  config!: HomeRailSceneConfigInputDto;
}
