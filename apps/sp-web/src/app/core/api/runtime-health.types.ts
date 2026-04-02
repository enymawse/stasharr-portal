import { CatalogProviderType } from './integrations.types';
import { DegradedRequiredService } from './setup.types';
import { integrationLabel } from './integrations.types';

export type RuntimeHealthServiceKey = 'CATALOG' | 'STASH' | 'WHISPARR';
export type RuntimeHealthStatus = 'HEALTHY' | 'DEGRADED';

export interface RuntimeHealthServiceSummary {
  service: RuntimeHealthServiceKey;
  status: RuntimeHealthStatus;
  degraded: boolean;
  consecutiveFailures: number;
  lastHealthyAt: string | null;
  lastFailureAt: string | null;
  lastErrorMessage: string | null;
  degradedAt: string | null;
}

export interface RuntimeHealthResponse {
  degraded: boolean;
  failureThreshold: number;
  services: {
    catalog: RuntimeHealthServiceSummary;
    stash: RuntimeHealthServiceSummary;
    whisparr: RuntimeHealthServiceSummary;
  };
}

export interface RuntimeDegradedStateSummary {
  count: number;
  services: DegradedRequiredService[];
  message: string;
}

export function summarizeRuntimeDegradedState(
  status: RuntimeHealthResponse | null | undefined,
  catalogProvider: CatalogProviderType | null | undefined,
): RuntimeDegradedStateSummary | null {
  if (!status || !status.degraded) {
    return null;
  }

  const services = getDegradedRuntimeServices(status, catalogProvider);
  if (services.length === 0) {
    return null;
  }

  if (services.length === 1) {
    const [service] = services;
    return {
      count: 1,
      services,
      message: `${service.label} is currently unavailable. ${service.impact}`,
    };
  }

  return {
    count: services.length,
    services,
    message: `${services.length} required integrations are currently degraded. Some app data may be unavailable or stale.`,
  };
}

function getDegradedRuntimeServices(
  status: RuntimeHealthResponse,
  catalogProvider: CatalogProviderType | null | undefined,
): DegradedRequiredService[] {
  const services: DegradedRequiredService[] = [];

  if (status.services.catalog.degraded) {
    services.push({
      key: 'CATALOG',
      label: catalogProvider ? integrationLabel(catalogProvider) : 'Catalog provider',
      impact: 'Discovery data may be unavailable or stale.',
    });
  }

  if (status.services.stash.degraded) {
    services.push({
      key: 'STASH',
      label: 'Stash',
      impact: 'Library and availability data may be degraded.',
    });
  }

  if (status.services.whisparr.degraded) {
    services.push({
      key: 'WHISPARR',
      label: 'Whisparr',
      impact: 'Acquisition and status updates may be stale.',
    });
  }

  return services;
}
