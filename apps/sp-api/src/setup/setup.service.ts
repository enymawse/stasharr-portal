import { Injectable } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import {
  configuredCatalogProviderTypeFromIntegrations,
  type CatalogProviderIntegrationType,
} from '../providers/catalog/catalog-provider.util';

export interface SetupStatusResponse {
  setupComplete: boolean;
  required: {
    stash: boolean;
    catalog: boolean;
    whisparr: boolean;
  };
  catalogProvider: CatalogProviderIntegrationType | null;
}

@Injectable()
export class SetupService {
  constructor(private readonly integrationsService: IntegrationsService) {}

  async getStatus(): Promise<SetupStatusResponse> {
    const integrations = await this.integrationsService.findAll();

    const isConfigured = (type: IntegrationType): boolean =>
      integrations.some(
        (integration) =>
          integration.type === type &&
          integration.status === IntegrationStatus.CONFIGURED,
      );
    const catalogProvider = configuredCatalogProviderTypeFromIntegrations(
      integrations.map((integration) => ({
        type: integration.type,
        enabled: integration.enabled,
        status: integration.status,
        baseUrl: integration.baseUrl,
      })),
    );

    const required = {
      stash: isConfigured(IntegrationType.STASH),
      catalog: catalogProvider !== null,
      whisparr: isConfigured(IntegrationType.WHISPARR),
    };

    return {
      setupComplete: required.stash && required.catalog && required.whisparr,
      required,
      catalogProvider,
    };
  }
}
