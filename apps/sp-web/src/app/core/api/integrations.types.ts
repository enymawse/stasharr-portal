export type CatalogProviderType = 'STASHDB' | 'FANSDB';
export type IntegrationType = 'STASH' | 'WHISPARR' | CatalogProviderType;

export function isCatalogProviderType(
  type: IntegrationType,
): type is CatalogProviderType {
  return type === 'STASHDB' || type === 'FANSDB';
}

export function integrationLabel(type: IntegrationType): string {
  switch (type) {
    case 'FANSDB':
      return 'FansDB';
    case 'STASHDB':
      return 'StashDB';
    case 'STASH':
      return 'Stash';
    case 'WHISPARR':
      return 'Whisparr';
  }
}

export interface IntegrationResponse {
  type: IntegrationType;
  enabled: boolean;
  status: 'NOT_CONFIGURED' | 'CONFIGURED' | 'ERROR';
  name: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  lastHealthyAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

export interface UpdateIntegrationPayload {
  enabled?: boolean;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
}

export function resolveConfiguredCatalogProviderType(
  integrations: ReadonlyArray<
    Pick<IntegrationResponse, 'type' | 'enabled' | 'status' | 'baseUrl'>
  >,
): CatalogProviderType | null {
  const configuredProviders = integrations.filter(
    (integration): integration is Pick<
      IntegrationResponse,
      'type' | 'enabled' | 'status' | 'baseUrl'
    > & { type: CatalogProviderType } =>
      isCatalogProviderType(integration.type) &&
      integration.status === 'CONFIGURED' &&
      !!integration.baseUrl?.trim(),
  );

  if (configuredProviders.length === 0) {
    return null;
  }

  const enabledConfiguredProviders = configuredProviders.filter(
    (integration) => integration.enabled,
  );
  if (enabledConfiguredProviders.length === 1) {
    return enabledConfiguredProviders[0].type;
  }

  return configuredProviders[0].type;
}
