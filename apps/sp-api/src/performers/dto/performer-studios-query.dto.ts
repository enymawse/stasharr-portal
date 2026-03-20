import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PerformerStudiosQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;
}
