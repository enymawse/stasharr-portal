import { IntegrationStatus } from '@prisma/client';

export const CATALOG_PROVIDER_KEYS = ['STASHDB', 'FANSDB'] as const;
const CATALOG_PROVIDER_SELECTION_KEY = 'selectedForInstanceCatalogProvider';

export type CatalogProviderKey = (typeof CATALOG_PROVIDER_KEYS)[number];
export type CatalogProviderIntegrationType = CatalogProviderKey;

const PROVIDER_PATTERNS: Record<CatalogProviderKey, readonly string[]> = {
  STASHDB: ['stashdb.org', 'stashdb'],
  FANSDB: ['fansdb.cc', 'fansdb'],
};

const CATALOG_REF_SEPARATOR = '|';

export function resolveCatalogProviderKey(
  value: string | null | undefined,
): CatalogProviderKey | null {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }

  const haystacks = [normalized.toLowerCase()];

  try {
    const parsed = new URL(normalized);
    haystacks.push(`${parsed.hostname}${parsed.pathname}`.toLowerCase());
  } catch {
    // Non-URL values still work through simple substring matching.
  }

  for (const providerKey of CATALOG_PROVIDER_KEYS) {
    if (
      PROVIDER_PATTERNS[providerKey].some((pattern) =>
        haystacks.some((haystack) => haystack.includes(pattern)),
      )
    ) {
      return providerKey;
    }
  }

  return null;
}

export function isCatalogProviderIntegrationType(
  value: string | null | undefined,
): value is CatalogProviderIntegrationType {
  return CATALOG_PROVIDER_KEYS.includes(
    (value ?? '').trim().toUpperCase() as CatalogProviderIntegrationType,
  );
}

export function catalogProviderKeyFromIntegrationType(
  type: CatalogProviderIntegrationType,
): CatalogProviderKey {
  return type;
}

export function getCatalogProviderLabel(
  providerKey: CatalogProviderKey | null | undefined,
): string {
  switch (providerKey) {
    case 'FANSDB':
      return 'FansDB';
    case 'STASHDB':
    default:
      return 'StashDB';
  }
}

export function configuredCatalogProviderTypeFromIntegrations(
  integrations: ReadonlyArray<{
    type: string;
    enabled?: boolean | null;
    status?: IntegrationStatus | null;
    baseUrl?: string | null;
  }>,
): CatalogProviderIntegrationType | null {
  const integrationsByType = new Map(
    integrations.map((integration) => [integration.type, integration]),
  );
  const configuredTypes = CATALOG_PROVIDER_KEYS.filter((providerType) => {
    const integration = integrationsByType.get(providerType);
    return (
      integration?.status === IntegrationStatus.CONFIGURED &&
      !!integration.baseUrl?.trim()
    );
  });

  if (configuredTypes.length === 0) {
    return null;
  }

  const enabledConfiguredTypes = configuredTypes.filter((providerType) => {
    const integration = integrationsByType.get(providerType);
    return integration?.enabled === true;
  });

  if (enabledConfiguredTypes.length === 1) {
    return enabledConfiguredTypes[0];
  }

  return configuredTypes[0];
}

export function instanceCatalogProviderTypeFromIntegrations(
  integrations: ReadonlyArray<{
    type: string;
    enabled?: boolean | null;
    status?: IntegrationStatus | null;
    baseUrl?: string | null;
    config?: unknown;
  }>,
): CatalogProviderIntegrationType | null {
  const integrationsByType = new Map(
    integrations.map((integration) => [integration.type, integration]),
  );
  const selectedTypes = CATALOG_PROVIDER_KEYS.filter((providerType) =>
    isCatalogProviderSelected(integrationsByType.get(providerType)?.config),
  );
  const explicitlySelectedType = pickCatalogProviderType(
    selectedTypes,
    integrationsByType,
  );

  if (explicitlySelectedType) {
    return explicitlySelectedType;
  }

  const legacySelectedTypes = CATALOG_PROVIDER_KEYS.filter((providerType) => {
    const integration = integrationsByType.get(providerType);
    return !!integration?.baseUrl?.trim();
  });

  return pickCatalogProviderType(legacySelectedTypes, integrationsByType);
}

export function isCatalogProviderReady(
  integration:
    | {
        status?: IntegrationStatus | null;
        baseUrl?: string | null;
      }
    | null
    | undefined,
): boolean {
  return (
    integration?.status === IntegrationStatus.CONFIGURED &&
    !!integration.baseUrl?.trim()
  );
}

export function buildCatalogProviderSelectionConfig(): Record<string, true> {
  return {
    [CATALOG_PROVIDER_SELECTION_KEY]: true,
  };
}

export function buildCatalogSceneRef(
  providerKey: CatalogProviderKey,
  externalId: string | null | undefined,
): string | null {
  const normalizedExternalId = normalizeValue(externalId);
  if (!normalizedExternalId) {
    return null;
  }

  return `${providerKey}${CATALOG_REF_SEPARATOR}${normalizedExternalId}`;
}

export function parseCatalogSceneRef(value: string | null | undefined): {
  providerKey: CatalogProviderKey;
  externalId: string;
} | null {
  const normalized = normalizeValue(value);
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf(CATALOG_REF_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const providerKey = normalized.slice(0, separatorIndex);
  const externalId = normalized.slice(separatorIndex + 1).trim();

  if (
    !CATALOG_PROVIDER_KEYS.includes(providerKey as CatalogProviderKey) ||
    externalId.length === 0
  ) {
    return null;
  }

  return {
    providerKey: providerKey as CatalogProviderKey,
    externalId,
  };
}

export function normalizeCatalogSceneRefs(
  values: ReadonlyArray<{
    endpoint: string;
    externalId: string;
  }>,
): string[] {
  const refs = new Set<string>();

  for (const value of values) {
    const providerKey = resolveCatalogProviderKey(value.endpoint);
    if (!providerKey) {
      continue;
    }

    const ref = buildCatalogSceneRef(providerKey, value.externalId);
    if (!ref) {
      continue;
    }

    refs.add(ref);
  }

  return [...refs];
}

export function findCatalogExternalIdForProvider(
  refs: readonly string[],
  providerKey: CatalogProviderKey,
): string | null {
  for (const ref of refs) {
    const parsed = parseCatalogSceneRef(ref);
    if (parsed?.providerKey === providerKey) {
      return parsed.externalId;
    }
  }

  return null;
}

export function hasCatalogSceneRef(
  refs: readonly string[],
  providerKey: CatalogProviderKey,
  externalId: string,
): boolean {
  const normalizedExternalId = normalizeValue(externalId);
  if (!normalizedExternalId) {
    return false;
  }

  return refs.some((ref) => {
    const parsed = parseCatalogSceneRef(ref);
    return (
      parsed?.providerKey === providerKey &&
      parsed.externalId === normalizedExternalId
    );
  });
}

function normalizeValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isCatalogProviderSelected(config: unknown): boolean {
  if (!isPlainObject(config)) {
    return false;
  }

  return config[CATALOG_PROVIDER_SELECTION_KEY] === true;
}

function pickCatalogProviderType(
  candidateTypes: readonly CatalogProviderIntegrationType[],
  integrationsByType: ReadonlyMap<
    string,
    {
      enabled?: boolean | null;
      status?: IntegrationStatus | null;
      baseUrl?: string | null;
    }
  >,
): CatalogProviderIntegrationType | null {
  if (candidateTypes.length === 0) {
    return null;
  }

  if (candidateTypes.length === 1) {
    return candidateTypes[0];
  }

  const enabledCandidateTypes = candidateTypes.filter(
    (providerType) => integrationsByType.get(providerType)?.enabled === true,
  );

  if (enabledCandidateTypes.length === 1) {
    return enabledCandidateTypes[0];
  }

  const readyCandidateTypes = candidateTypes.filter((providerType) =>
    isCatalogProviderReady(integrationsByType.get(providerType)),
  );

  if (readyCandidateTypes.length === 1) {
    return readyCandidateTypes[0];
  }

  return candidateTypes[0];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
