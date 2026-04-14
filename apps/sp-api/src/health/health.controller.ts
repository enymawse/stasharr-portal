import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_APP_VERSION = '0.0.0-dev';

@Controller('api/v1/status')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async getStatus() {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: 'ok',
      database: 'ok',
      service: 'sp-api',
      version: resolveAppVersion(),
    };
  }
}

export function resolveAppVersion(): string {
  return (
    normalizeVersion(process.env.STASHARR_VERSION) ??
    normalizeVersion(process.env.npm_package_version) ??
    DEFAULT_APP_VERSION
  );
}

function normalizeVersion(value: string | undefined): string | undefined {
  const version = value?.trim();
  return version ? version : undefined;
}
