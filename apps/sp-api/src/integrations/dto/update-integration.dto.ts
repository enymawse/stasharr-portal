import { IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateIntegrationDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUrl({
    require_tld: false,
    require_protocol: true,
  })
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;
}
