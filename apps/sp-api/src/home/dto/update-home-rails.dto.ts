import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsString,
  ValidateNested,
} from 'class-validator';

export class UpdateHomeRailItemDto {
  @IsString()
  id!: string;

  @Type(() => Boolean)
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateHomeRailsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateHomeRailItemDto)
  rails!: UpdateHomeRailItemDto[];
}
