import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ScenesTagsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}
