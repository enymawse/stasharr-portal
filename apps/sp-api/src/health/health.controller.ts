import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/v1/status')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getStatus() {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: 'ok',
      database: 'ok',
      service: 'sp-api',
    };
  }
}
