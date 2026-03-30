import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

export class LibraryOptionsQueryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || undefined : undefined,
  )
  @IsString()
  query?: string;
}
