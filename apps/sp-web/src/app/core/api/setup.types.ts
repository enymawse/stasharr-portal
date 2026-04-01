import { CatalogProviderType, integrationLabel } from './integrations.types';

export interface SetupStatusResponse {
  setupComplete: boolean;
  required: {
    stash: boolean;
    catalog: boolean;
    whisparr: boolean;
  };
  catalogProvider: CatalogProviderType | null;
}

export type DegradedRequiredServiceKey = 'CATALOG' | 'STASH' | 'WHISPARR';

export interface DegradedRequiredService {
  key: DegradedRequiredServiceKey;
  label: string;
  impact: string;
}

export interface SetupDegradedStateSummary {
  count: number;
  services: DegradedRequiredService[];
  message: string;
}

export function summarizeDegradedSetupState(
  status: SetupStatusResponse | null | undefined,
): SetupDegradedStateSummary | null {
  if (!status) {
    return null;
  }

  const services = getDegradedRequiredServices(status);
  if (services.length === 0) {
    return null;
  }

  if (services.length === 1) {
    const [service] = services;
    return {
      count: 1,
      services,
      message: `${service.label} needs repair. ${service.impact}`,
    };
  }

  return {
    count: services.length,
    services,
    message: `${services.length} required integrations need repair. Some app data may be unavailable or stale.`,
  };
}

function getDegradedRequiredServices(status: SetupStatusResponse): DegradedRequiredService[] {
  const services: DegradedRequiredService[] = [];

  if (!status.required.catalog) {
    services.push({
      key: 'CATALOG',
      label: status.catalogProvider ? integrationLabel(status.catalogProvider) : 'Catalog provider',
      impact: 'Discovery data may be unavailable or stale.',
    });
  }

  if (!status.required.stash) {
    services.push({
      key: 'STASH',
      label: 'Stash',
      impact: 'Library and availability data may be degraded.',
    });
  }

  if (!status.required.whisparr) {
    services.push({
      key: 'WHISPARR',
      label: 'Whisparr',
      impact: 'Acquisition and status updates may be stale.',
    });
  }

  return services;
}
