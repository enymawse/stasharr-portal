import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IntegrationConfig,
  IntegrationStatus,
  IntegrationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<IntegrationConfig[]> {
    return this.prisma.integrationConfig.findMany({
      orderBy: { type: 'asc' },
    });
  }

  async upsert(
    type: IntegrationType,
    dto: UpdateIntegrationDto,
  ): Promise<IntegrationConfig> {
    const configured =
      !!dto.baseUrl?.trim() || !!dto.apiKey?.trim() || !!dto.name?.trim();

    return this.prisma.integrationConfig.upsert({
      where: { type },
      update: {
        enabled: dto.enabled,
        name: dto.name,
        baseUrl: dto.baseUrl,
        apiKey: dto.apiKey,
        status: configured
          ? IntegrationStatus.CONFIGURED
          : IntegrationStatus.NOT_CONFIGURED,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
      create: {
        type,
        enabled: dto.enabled ?? true,
        name: dto.name,
        baseUrl: dto.baseUrl,
        apiKey: dto.apiKey,
        status: configured
          ? IntegrationStatus.CONFIGURED
          : IntegrationStatus.NOT_CONFIGURED,
      },
    });
  }

  async findOne(type: IntegrationType): Promise<IntegrationConfig> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { type },
    });

    if (!integration) {
      throw new NotFoundException(`Integration ${type} not found`);
    }

    return integration;
  }

  async reset(type: IntegrationType): Promise<IntegrationConfig> {
    return this.prisma.integrationConfig.upsert({
      where: { type },
      update: this.resetPayload(),
      create: {
        type,
        ...this.resetPayload(),
      },
    });
  }

  async resetAll(): Promise<IntegrationConfig[]> {
    const types = Object.values(IntegrationType);

    const resetRecords = await this.prisma.$transaction(
      types.map((type) =>
        this.prisma.integrationConfig.upsert({
          where: { type },
          update: this.resetPayload(),
          create: {
            type,
            ...this.resetPayload(),
          },
        }),
      ),
    );

    return resetRecords.sort((a, b) => a.type.localeCompare(b.type));
  }

  private resetPayload() {
    return {
      enabled: true,
      name: null,
      baseUrl: null,
      apiKey: null,
      config: Prisma.JsonNull,
      status: IntegrationStatus.NOT_CONFIGURED,
      lastHealthyAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    };
  }
}
