import { CatalogProviderType } from './integrations.types';

export interface SetupStatusResponse {
  setupComplete: boolean;
  required: {
    stash: boolean;
    catalog: boolean;
    whisparr: boolean;
  };
  activeCatalogProvider: CatalogProviderType | null;
  catalogProviders: Record<CatalogProviderType, boolean>;
}
