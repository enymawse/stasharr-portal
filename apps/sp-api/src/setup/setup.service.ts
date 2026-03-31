import { Injectable } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { type CatalogProviderIntegrationType } from '../providers/catalog/catalog-provider.util';

export interface SetupStatusResponse {
  setupComplete: boolean;
  required: {
    stash: boolean;
    catalog: boolean;
    whisparr: boolean;
  };
  activeCatalogProvider: CatalogProviderIntegrationType | null;
  catalogProviders: Record<CatalogProviderIntegrationType, boolean>;
}

@Injectable()
export class SetupService {
  constructor(private readonly integrationsService: IntegrationsService) {}

  async getStatus(): Promise<SetupStatusResponse> {
    const integrations = await this.integrationsService.findAll();
    const integrationByType = new Map(
      integrations.map((integration) => [integration.type, integration]),
    );

    const isConfigured = (type: IntegrationType): boolean =>
      integrations.some(
        (integration) =>
          integration.type === type &&
          integration.status === IntegrationStatus.CONFIGURED,
      );
    const isEnabled = (type: IntegrationType): boolean =>
      integrations.some(
        (integration) => integration.type === type && integration.enabled,
      );
    const isActiveCatalogProvider = (type: CatalogProviderIntegrationType): boolean => {
      const integration = integrationByType.get(type);
      return (
        integration?.enabled === true &&
        integration.status === IntegrationStatus.CONFIGURED &&
        !!integration.baseUrl?.trim()
      );
    };

    const activeCatalogProvider =
      (isActiveCatalogProvider(IntegrationType.STASHDB)
        ? IntegrationType.STASHDB
        : isActiveCatalogProvider(IntegrationType.FANSDB)
          ? IntegrationType.FANSDB
          : null) as CatalogProviderIntegrationType | null;

    const required = {
      stash: isConfigured(IntegrationType.STASH),
      catalog: activeCatalogProvider !== null,
      whisparr: isConfigured(IntegrationType.WHISPARR),
    };

    return {
      setupComplete: required.stash && required.catalog && required.whisparr,
      required,
      activeCatalogProvider,
      catalogProviders: {
        STASHDB: isConfigured(IntegrationType.STASHDB),
        FANSDB: isConfigured(IntegrationType.FANSDB),
      },
    };
  }
}
