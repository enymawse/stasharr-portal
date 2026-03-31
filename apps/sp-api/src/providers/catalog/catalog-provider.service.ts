import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { IntegrationConfig, IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../../integrations/integrations.service';
import {
  CATALOG_PROVIDER_KEYS,
  type CatalogProviderIntegrationType,
  type CatalogProviderKey,
  catalogProviderKeyFromIntegrationType,
  getCatalogProviderLabel,
  isCatalogProviderIntegrationType,
} from './catalog-provider.util';

export interface ActiveCatalogProvider {
  integrationType: CatalogProviderIntegrationType;
  providerKey: CatalogProviderKey;
  label: string;
  baseUrl: string;
  apiKey: string | null;
}

@Injectable()
export class CatalogProviderService {
  constructor(private readonly integrationsService: IntegrationsService) {}

  async getSelectedCatalogProviderType(): Promise<CatalogProviderIntegrationType | null> {
    const integrations = await this.integrationsService.findAll();
    const integrationsByType = new Map(
      integrations.map((integration) => [integration.type, integration]),
    );

    const configuredProvider = this.findCatalogProviderType(
      integrationsByType,
      (integration) =>
        integration.enabled &&
        integration.status === IntegrationStatus.CONFIGURED &&
        !!integration.baseUrl?.trim(),
    );
    if (configuredProvider) {
      return configuredProvider;
    }

    return this.findCatalogProviderType(
      integrationsByType,
      (integration) => integration.enabled,
    );
  }

  private findCatalogProviderType(
    integrationsByType: Map<IntegrationType, IntegrationConfig>,
    predicate: (integration: IntegrationConfig) => boolean,
  ): CatalogProviderIntegrationType | null {
    for (const providerType of CATALOG_PROVIDER_KEYS) {
      const integration = integrationsByType.get(providerType as IntegrationType);
      if (
        isCatalogProviderIntegrationType(providerType) &&
        integration &&
        predicate(integration)
      ) {
        return providerType;
      }
    }

    return null;
  }

  async getActiveCatalogProviderOrNull(): Promise<ActiveCatalogProvider | null> {
    const selectedType = await this.getSelectedCatalogProviderType();
    if (!selectedType) {
      return null;
    }

    try {
      const integration = await this.integrationsService.findOne(
        selectedType as IntegrationType,
      );

      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      return {
        integrationType: selectedType,
        providerKey: catalogProviderKeyFromIntegrationType(selectedType),
        label: getCatalogProviderLabel(selectedType),
        baseUrl,
        apiKey: integration.apiKey,
      };
    } catch {
      return null;
    }
  }

  async getActiveCatalogProvider(): Promise<ActiveCatalogProvider> {
    const selectedType = await this.getSelectedCatalogProviderType();
    if (!selectedType) {
      throw new ConflictException('No active catalog provider is enabled.');
    }

    const integration = await this.integrationsService.findOne(
      selectedType as IntegrationType,
    );
    const label = getCatalogProviderLabel(selectedType);

    if (!integration.enabled) {
      throw new ConflictException(`No active catalog provider is enabled.`);
    }

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException(`${label} integration is not configured.`);
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new BadRequestException(`${label} integration is missing a base URL.`);
    }

    return {
      integrationType: selectedType,
      providerKey: catalogProviderKeyFromIntegrationType(selectedType),
      label,
      baseUrl,
      apiKey: integration.apiKey,
    };
  }
}
