import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { HOME_RAIL_KEY_VALUES, type HomeRailKey } from './home-rail.dto';

export class UpdateHomeRailItemDto {
  @IsIn(HOME_RAIL_KEY_VALUES)
  key!: HomeRailKey;

  @IsBoolean()
  enabled!: boolean;
}

export class UpdateHomeRailsDto {
  @IsArray()
  @ArrayMinSize(HOME_RAIL_KEY_VALUES.length)
  @ArrayMaxSize(HOME_RAIL_KEY_VALUES.length)
  @ValidateNested({ each: true })
  @Type(() => UpdateHomeRailItemDto)
  rails!: UpdateHomeRailItemDto[];
}
