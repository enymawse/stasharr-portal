import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import {
  CATALOG_PROVIDER_KEYS,
  type CatalogProviderIntegrationType,
  buildCatalogProviderSelectionConfig,
  getCatalogProviderLabel,
  instanceCatalogProviderTypeFromIntegrations,
  isCatalogProviderIntegrationType,
} from '../providers/catalog/catalog-provider.util';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

type PersistedIntegrationValues = {
  enabled: boolean;
  name: string | null;
  baseUrl: string | null;
  apiKey: string | null;
};

type PersistedIntegrationState = {
  status: IntegrationStatus;
  lastHealthyAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
};

type TestedIntegrationConfig = IntegrationConfig & {
  status: Extract<IntegrationStatus, 'CONFIGURED' | 'ERROR'>;
};

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
    const existing = await this.prisma.integrationConfig.findUnique({
      where: { type },
    });
    const isCatalogProvider = isCatalogProviderIntegrationType(type);
    const persistedValues = this.resolvePersistedValues(type, dto, existing);
    const configured = this.hasSavedConfig(type, persistedValues);

    if (isCatalogProvider) {
      await this.assertCatalogProviderSaveAllowed(type, configured);
    }

    const healthState = this.resolveSavedHealthState(
      existing,
      persistedValues,
      configured,
    );
    const selectionConfig =
      isCatalogProvider && configured
        ? this.catalogProviderSelectionConfig()
        : undefined;
    const updateData = {
      ...persistedValues,
      ...healthState,
      ...(selectionConfig ? { config: selectionConfig } : {}),
    } satisfies Prisma.IntegrationConfigUpdateInput;
    const createData = {
      type,
      ...persistedValues,
      status: IntegrationStatus.NOT_CONFIGURED,
      lastHealthyAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      ...(selectionConfig ? { config: selectionConfig } : {}),
    } satisfies Prisma.IntegrationConfigCreateInput;
    const upsertArgs = {
      where: { type },
      update: updateData,
      create: createData,
    } satisfies Prisma.IntegrationConfigUpsertArgs;

    if (isCatalogProvider && configured) {
      const [, integration] = await this.prisma.$transaction([
        this.prisma.integrationConfig.updateMany({
          where: {
            type: {
              in: this.otherCatalogProviderTypes(type),
            },
          },
          data: this.resetPayload(),
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
  ): Promise<TestedIntegrationConfig> {
    if (isCatalogProviderIntegrationType(type)) {
      await this.assertCatalogProviderMutationAllowed(type);
    }

    const existing = await this.prisma.integrationConfig.findUnique({
      where: { type },
    });
    const persistedValues = this.resolvePersistedValues(type, dto, existing);
    const selectionConfig = isCatalogProviderIntegrationType(type)
      ? this.catalogProviderSelectionConfig()
      : undefined;
    const configChanged = this.connectionDetailsChanged(existing, persistedValues);

    try {
      const config = this.resolveTestConfig(persistedValues);

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
      return this.persistIntegration(
        type,
        {
          ...persistedValues,
          status: IntegrationStatus.CONFIGURED,
          lastHealthyAt: now,
          lastErrorAt: null,
          lastErrorMessage: null,
        },
        selectionConfig,
      ) as Promise<TestedIntegrationConfig>;
    } catch (error) {
      const message = this.resolveErrorMessage(error);
      return this.persistIntegration(
        type,
        {
          ...persistedValues,
          status: IntegrationStatus.ERROR,
          lastHealthyAt:
            configChanged || !existing?.lastHealthyAt
              ? null
              : existing.lastHealthyAt,
          lastErrorAt: new Date(),
          lastErrorMessage: message,
        },
        selectionConfig,
      ) as Promise<TestedIntegrationConfig>;
    }
  }

  async reset(type: IntegrationType): Promise<IntegrationConfig> {
    if (isCatalogProviderIntegrationType(type)) {
      const resetRecords = await this.prisma.$transaction(
        CATALOG_PROVIDER_KEYS.map((providerType) =>
          this.prisma.integrationConfig.upsert({
            where: { type: providerType },
            update: this.resetPayload(),
            create: {
              type: providerType,
              ...this.resetPayload(),
            },
          }),
        ),
      );

      const resetIntegration = resetRecords.find(
        (integration) => integration.type === type,
      );
      if (resetIntegration) {
        return resetIntegration;
      }
    }

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

  private async assertCatalogProviderSaveAllowed(
    type: CatalogProviderIntegrationType,
    nextConfigured: boolean,
  ): Promise<void> {
    const configuredType =
      await this.assertCatalogProviderMutationAllowed(type);

    if (!configuredType) {
      return;
    }

    if (configuredType !== type) {
      throw new ConflictException(
        `This Stasharr instance is configured for ${getCatalogProviderLabel(configuredType)}. Reset catalog setup before configuring ${getCatalogProviderLabel(type)}.`,
      );
    }

    if (!nextConfigured) {
      throw new ConflictException(
        `This Stasharr instance is configured for ${getCatalogProviderLabel(type)}. Reset catalog setup before clearing or changing the catalog provider.`,
      );
    }
  }

  private async assertCatalogProviderMutationAllowed(
    type: CatalogProviderIntegrationType,
  ): Promise<CatalogProviderIntegrationType | null> {
    const configuredType = await this.getInstanceCatalogProviderType();

    if (!configuredType) {
      return null;
    }

    if (configuredType !== type) {
      throw new ConflictException(
        `This Stasharr instance is configured for ${getCatalogProviderLabel(configuredType)}. Reset catalog setup before configuring ${getCatalogProviderLabel(type)}.`,
      );
    }

    return configuredType;
  }

  private otherCatalogProviderTypes(
    type: CatalogProviderIntegrationType,
  ): CatalogProviderIntegrationType[] {
    return CATALOG_PROVIDER_KEYS.filter(
      (providerType) => providerType !== type,
    );
  }

  private resolveTestConfig(
    values: PersistedIntegrationValues,
  ):
    | StashAdapterBaseConfig
    | StashdbAdapterBaseConfig
    | WhisparrAdapterBaseConfig {
    const baseUrl = values.baseUrl;
    const apiKey = values.apiKey;

    if (!baseUrl) {
      throw new Error('Base URL is required to test this integration.');
    }

    return {
      baseUrl,
      apiKey,
    };
  }

  private resolvePersistedValues(
    type: IntegrationType,
    dto: UpdateIntegrationDto,
    existing: IntegrationConfig | null,
  ): PersistedIntegrationValues {
    return {
      enabled: isCatalogProviderIntegrationType(type)
        ? true
        : (dto.enabled ?? existing?.enabled ?? true),
      name: this.mergeNormalizedInput(existing?.name, dto.name),
      baseUrl: this.mergeNormalizedInput(existing?.baseUrl, dto.baseUrl),
      apiKey: this.mergeNormalizedInput(existing?.apiKey, dto.apiKey),
    };
  }

  private resolveSavedHealthState(
    existing: IntegrationConfig | null,
    values: PersistedIntegrationValues,
    configured: boolean,
  ): PersistedIntegrationState {
    if (!configured || !existing || this.connectionDetailsChanged(existing, values)) {
      return {
        status: IntegrationStatus.NOT_CONFIGURED,
        lastHealthyAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      };
    }

    return {
      status: existing.status,
      lastHealthyAt: existing.lastHealthyAt,
      lastErrorAt: existing.lastErrorAt,
      lastErrorMessage: existing.lastErrorMessage,
    };
  }

  private async persistIntegration(
    type: IntegrationType,
    state: PersistedIntegrationValues & PersistedIntegrationState,
    selectionConfig?: Prisma.InputJsonValue,
  ): Promise<IntegrationConfig> {
    const updateData = {
      ...state,
      ...(selectionConfig ? { config: selectionConfig } : {}),
    } satisfies Prisma.IntegrationConfigUpdateInput;
    const createData = {
      type,
      ...state,
      ...(selectionConfig ? { config: selectionConfig } : {}),
    } satisfies Prisma.IntegrationConfigCreateInput;
    const upsertArgs = {
      where: { type },
      update: updateData,
      create: createData,
    } satisfies Prisma.IntegrationConfigUpsertArgs;

    if (isCatalogProviderIntegrationType(type) && this.hasSavedConfig(type, state)) {
      const [, integration] = await this.prisma.$transaction([
        this.prisma.integrationConfig.updateMany({
          where: {
            type: {
              in: this.otherCatalogProviderTypes(type),
            },
          },
          data: this.resetPayload(),
        }),
        this.prisma.integrationConfig.upsert(upsertArgs),
      ]);

      return integration as IntegrationConfig;
    }

    return this.prisma.integrationConfig.upsert(upsertArgs);
  }

  private hasSavedConfig(
    type: IntegrationType,
    values: Pick<PersistedIntegrationValues, 'name' | 'baseUrl' | 'apiKey'>,
  ): boolean {
    if (isCatalogProviderIntegrationType(type)) {
      return !!values.baseUrl;
    }

    return !!values.baseUrl || !!values.apiKey || !!values.name;
  }

  private connectionDetailsChanged(
    existing: IntegrationConfig | null,
    values: Pick<PersistedIntegrationValues, 'baseUrl' | 'apiKey'>,
  ): boolean {
    return (
      (existing?.baseUrl ?? null) !== values.baseUrl ||
      (existing?.apiKey ?? null) !== values.apiKey
    );
  }

  private mergeNormalizedInput(
    existingValue: string | null | undefined,
    nextValue: string | null | undefined,
  ): string | null {
    return this.normalizeInput(nextValue) ?? existingValue ?? null;
  }

  private async getInstanceCatalogProviderType(): Promise<CatalogProviderIntegrationType | null> {
    const catalogIntegrations = await this.prisma.integrationConfig.findMany({
      where: {
        type: {
          in: [...CATALOG_PROVIDER_KEYS],
        },
      },
      orderBy: { type: 'asc' },
    });

    return instanceCatalogProviderTypeFromIntegrations(catalogIntegrations);
  }

  private catalogProviderSelectionConfig(): Prisma.InputJsonValue {
    return buildCatalogProviderSelectionConfig() as Prisma.InputJsonValue;
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
