import { Injectable } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { type CatalogProviderIntegrationType } from '../providers/catalog/catalog-provider.util';

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
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly catalogProviderService: CatalogProviderService,
  ) {}

  async getStatus(): Promise<SetupStatusResponse> {
    const [integrations, catalogProvider, configuredCatalogProvider] =
      await Promise.all([
        this.integrationsService.findAll(),
        this.catalogProviderService.getInstanceCatalogProviderType(),
        this.catalogProviderService.getConfiguredCatalogProviderType(),
      ]);

    const isConfigured = (type: IntegrationType): boolean =>
      integrations.some(
        (integration) =>
          integration.type === type &&
          integration.status === IntegrationStatus.CONFIGURED,
      );

    const required = {
      stash: isConfigured(IntegrationType.STASH),
      catalog:
        catalogProvider !== null &&
        configuredCatalogProvider === catalogProvider,
      whisparr: isConfigured(IntegrationType.WHISPARR),
    };

    return {
      setupComplete: required.stash && required.catalog && required.whisparr,
      required,
      catalogProvider,
    };
  }
}
