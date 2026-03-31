import { CatalogProviderType } from './integrations.types';

export interface SetupStatusResponse {
  setupComplete: boolean;
  required: {
    stash: boolean;
    catalog: boolean;
    whisparr: boolean;
  };
  catalogProvider: CatalogProviderType | null;
}
