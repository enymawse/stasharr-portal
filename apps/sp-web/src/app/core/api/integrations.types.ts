export type CatalogProviderType = 'STASHDB' | 'FANSDB';
export type IntegrationType = 'STASH' | 'WHISPARR' | CatalogProviderType;
export type IntegrationStatus = 'NOT_CONFIGURED' | 'CONFIGURED' | 'ERROR';
export type IntegrationTestStatus = 'CONFIGURED' | 'ERROR';
export type ReadinessState = 'NOT_SAVED' | 'SAVED' | 'TEST_FAILED' | 'READY';

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
  status: IntegrationStatus;
  name: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  lastHealthyAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

export interface IntegrationTestResponse extends Omit<IntegrationResponse, 'status'> {
  status: IntegrationTestStatus;
}

export interface UpdateIntegrationPayload {
  enabled?: boolean;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
}

export function hasSavedIntegrationConfig(
  integration:
    | Pick<IntegrationResponse, 'type' | 'name' | 'baseUrl' | 'hasApiKey'>
    | null
    | undefined,
): boolean {
  if (!integration) {
    return false;
  }

  if (isCatalogProviderType(integration.type)) {
    return !!integration.baseUrl?.trim();
  }

  return (
    !!integration.baseUrl?.trim() ||
    integration.hasApiKey ||
    !!integration.name?.trim()
  );
}

export function isIntegrationReady(
  integration:
    | Pick<
        IntegrationResponse,
        'enabled' | 'status' | 'baseUrl' | 'lastHealthyAt'
      >
    | null
    | undefined,
): boolean {
  return (
    integration?.enabled === true &&
    integration.status === 'CONFIGURED' &&
    !!integration.baseUrl?.trim() &&
    !!integration.lastHealthyAt
  );
}

export function integrationReadinessState(
  integration:
    | Pick<
        IntegrationResponse,
        'type' | 'name' | 'baseUrl' | 'hasApiKey' | 'enabled' | 'status' | 'lastHealthyAt'
      >
    | null
    | undefined,
): ReadinessState {
  if (!integration || !hasSavedIntegrationConfig(integration)) {
    return 'NOT_SAVED';
  }

  if (integration.status === 'ERROR') {
    return 'TEST_FAILED';
  }

  return isIntegrationReady(integration) ? 'READY' : 'SAVED';
}

export function integrationReadinessLabel(state: ReadinessState): string {
  switch (state) {
    case 'NOT_SAVED':
      return 'Not Saved';
    case 'SAVED':
      return 'Saved';
    case 'TEST_FAILED':
      return 'Test Failed';
    case 'READY':
      return 'Ready';
  }
}

export function resolveConfiguredCatalogProviderType(
  integrations: ReadonlyArray<
    Pick<
      IntegrationResponse,
      'type' | 'enabled' | 'status' | 'baseUrl' | 'lastHealthyAt'
    >
  >,
): CatalogProviderType | null {
  const configuredProviders = integrations.filter(
    (integration): integration is Pick<
      IntegrationResponse,
      'type' | 'enabled' | 'status' | 'baseUrl' | 'lastHealthyAt'
    > & { type: CatalogProviderType } =>
      isCatalogProviderType(integration.type) &&
      isIntegrationReady(integration),
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
