import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IntegrationConfig,
  IntegrationStatus,
  IntegrationType,
  Prisma,
} from '@prisma/client';
import {
  StashAdapter,
  StashAdapterBaseConfig,
} from '../providers/stash/stash.adapter';
import {
  StashdbAdapter,
  StashdbAdapterBaseConfig,
} from '../providers/stashdb/stashdb.adapter';
import {
  WhisparrAdapter,
  WhisparrAdapterBaseConfig,
} from '../providers/whisparr/whisparr.adapter';
import { isCatalogProviderIntegrationType } from '../providers/catalog/catalog-provider.util';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stashAdapter: StashAdapter,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly whisparrAdapter: WhisparrAdapter,
  ) {}

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

    const upsertArgs = {
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
    } satisfies Prisma.IntegrationConfigUpsertArgs;

    if (isCatalogProviderIntegrationType(type) && dto.enabled === true) {
      const [, integration] = await this.prisma.$transaction([
        this.prisma.integrationConfig.updateMany({
          where: {
            type: {
              in: Object.values(IntegrationType).filter(
                (candidate) => candidate !== type && isCatalogProviderIntegrationType(candidate),
              ),
            },
          },
          data: {
            enabled: false,
          },
        }),
        this.prisma.integrationConfig.upsert(upsertArgs),
      ]);

      return integration;
    }

    return this.prisma.integrationConfig.upsert(upsertArgs);
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

  async testIntegration(
    type: IntegrationType,
    dto: UpdateIntegrationDto,
  ): Promise<IntegrationConfig> {
    try {
      const config = await this.resolveTestConfig(type, dto);

      switch (type) {
        case IntegrationType.STASH:
          await this.stashAdapter.testConnection(config);
          break;
        case IntegrationType.STASHDB:
        case IntegrationType.FANSDB:
          await this.stashdbAdapter.testConnection(config);
          break;
        case IntegrationType.WHISPARR:
          await this.whisparrAdapter.testConnection(config);
          break;
      }

      const now = new Date();
      return this.prisma.integrationConfig.upsert({
        where: { type },
        update: {
          status: IntegrationStatus.CONFIGURED,
          lastHealthyAt: now,
          lastErrorAt: null,
          lastErrorMessage: null,
        },
        create: {
          type,
          enabled: true,
          status: IntegrationStatus.CONFIGURED,
          lastHealthyAt: now,
          lastErrorAt: null,
          lastErrorMessage: null,
        },
      });
    } catch (error) {
      const message = this.resolveErrorMessage(error);
      const failed = await this.prisma.integrationConfig.upsert({
        where: { type },
        update: {
          status: IntegrationStatus.ERROR,
          lastErrorAt: new Date(),
          lastErrorMessage: message,
        },
        create: {
          type,
          enabled: true,
          status: IntegrationStatus.ERROR,
          lastErrorAt: new Date(),
          lastErrorMessage: message,
        },
      });

      return failed;
    }
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

  private async resolveTestConfig(
    type: IntegrationType,
    dto: UpdateIntegrationDto,
  ): Promise<
    | StashAdapterBaseConfig
    | StashdbAdapterBaseConfig
    | WhisparrAdapterBaseConfig
  > {
    const existing = await this.prisma.integrationConfig.findUnique({
      where: { type },
    });

    const baseUrl =
      this.normalizeInput(dto.baseUrl) ?? existing?.baseUrl ?? null;
    const apiKey = this.normalizeInput(dto.apiKey) ?? existing?.apiKey ?? null;

    if (!baseUrl) {
      throw new Error('Base URL is required to test this integration.');
    }

    return {
      baseUrl,
      apiKey,
    };
  }

  private normalizeInput(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }

    return 'Integration test failed.';
  }
}
