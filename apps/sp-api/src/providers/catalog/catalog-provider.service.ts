import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../../integrations/integrations.service';
import {
  type CatalogProviderIntegrationType,
  type CatalogProviderKey,
  catalogProviderKeyFromIntegrationType,
  instanceCatalogProviderTypeFromIntegrations,
  isCatalogProviderReady,
  getCatalogProviderLabel,
} from './catalog-provider.util';

export interface ConfiguredCatalogProvider {
  integrationType: CatalogProviderIntegrationType;
  providerKey: CatalogProviderKey;
  label: string;
  baseUrl: string;
  apiKey: string | null;
}

@Injectable()
export class CatalogProviderService {
  constructor(private readonly integrationsService: IntegrationsService) {}

  async getInstanceCatalogProviderType(): Promise<CatalogProviderIntegrationType | null> {
    const integrations = await this.integrationsService.findAll();
    return instanceCatalogProviderTypeFromIntegrations(
      integrations.map((integration) => ({
        type: integration.type,
        enabled: integration.enabled,
        status: integration.status,
        baseUrl: integration.baseUrl,
        config: integration.config,
      })),
    );
  }

  async getConfiguredCatalogProviderType(): Promise<CatalogProviderIntegrationType | null> {
    const selectedType = await this.getInstanceCatalogProviderType();
    if (!selectedType) {
      return null;
    }

    try {
      const integration = await this.integrationsService.findOne(
        selectedType as IntegrationType,
      );

      return isCatalogProviderReady(integration) ? selectedType : null;
    } catch {
      return null;
    }
  }

  async getConfiguredCatalogProviderOrNull(): Promise<ConfiguredCatalogProvider | null> {
    const selectedType = await this.getConfiguredCatalogProviderType();
    if (!selectedType) {
      return null;
    }

    try {
      const integration = await this.integrationsService.findOne(
        selectedType as IntegrationType,
      );

      if (integration.status !== IntegrationStatus.CONFIGURED) {
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

  async getConfiguredCatalogProvider(): Promise<ConfiguredCatalogProvider> {
    const selectedType = await this.getInstanceCatalogProviderType();
    if (!selectedType) {
      throw new ConflictException(
        'No catalog provider has been chosen for this Stasharr instance.',
      );
    }

    const integration = await this.integrationsService.findOne(
      selectedType as IntegrationType,
    );
    const label = getCatalogProviderLabel(selectedType);
    const baseUrl = integration.baseUrl?.trim();

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException(`${label} catalog provider is not configured.`);
    }

    if (!baseUrl) {
      throw new BadRequestException(
        `${label} catalog provider is missing a base URL.`,
      );
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
