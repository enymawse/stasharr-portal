import { RuntimeHealthResponse } from '../../core/api/runtime-health.types';
import { SetupStatusResponse } from '../../core/api/setup.types';

export type ReadinessSurface = 'home' | 'scenes' | 'library' | 'acquisition';
export type ReadinessService = 'CATALOG' | 'STASH' | 'WHISPARR';

export interface FirstUseEmptyStateCopy {
  title: string;
  message: string;
}

export interface ReadinessPageAlert {
  eyebrow: string;
  title: string;
  message: string;
  impactedServices: ReadinessService[];
}

export function setupCompleteSummary(catalogProviderLabel: string): string {
  return `${catalogProviderLabel} is ready with Stash and Whisparr. Home and Scenes are available now; Library, Acquisition, and status badges get better after the initial indexing sync has run.`;
}

export function initialIndexingGuidance(): string {
  return 'Use Indexing & Sync after setup to run Sync All when Library is empty, Acquisition looks stale, or status badges do not reflect Whisparr and Stash yet.';
}

export function firstUseEmptyStateCopy(surface: ReadinessSurface): FirstUseEmptyStateCopy {
  switch (surface) {
    case 'home':
      return {
        title: 'Home is waiting for useful scene data',
        message:
          'Scenes can be browsed from the catalog now. Run the initial indexing sync if Library rails, acquisition status, or local availability still look empty.',
      };
    case 'scenes':
      return {
        title: 'No catalog scenes are available yet',
        message:
          'Catalog browsing does not depend on local indexing. If this stays empty, check the catalog integration; otherwise use indexing to refresh local Library and status overlays.',
      };
    case 'library':
      return {
        title: 'No local scenes are indexed yet',
        message:
          'Run Sync All from Indexing & Sync to project your Stash library into Stasharr. You can keep browsing Scenes while the local library catches up.',
      };
    case 'acquisition':
      return {
        title: 'No acquisition activity is indexed yet',
        message:
          'Requests begin in Scenes. Run the initial indexing sync if you already have Whisparr activity and this page still looks empty.',
      };
  }
}

export function buildReadinessPageAlert(
  surface: ReadinessSurface,
  setupStatus: SetupStatusResponse | null | undefined,
  runtimeStatus: RuntimeHealthResponse | null | undefined,
): ReadinessPageAlert | null {
  const setupImpacts = impactedSetupServices(setupStatus, surface);
  if (setupImpacts.length > 0) {
    return alertForImpacts(surface, setupImpacts, 'setup');
  }

  const runtimeImpacts = impactedRuntimeServices(runtimeStatus, surface);
  if (runtimeImpacts.length > 0) {
    return alertForImpacts(surface, runtimeImpacts, 'runtime');
  }

  return null;
}

function impactedSetupServices(
  status: SetupStatusResponse | null | undefined,
  surface: ReadinessSurface,
): ReadinessService[] {
  if (!status) {
    return [];
  }

  const services = servicesForSurface(surface);
  return services.filter((service) => {
    switch (service) {
      case 'CATALOG':
        return !status.required.catalog;
      case 'STASH':
        return !status.required.stash;
      case 'WHISPARR':
        return !status.required.whisparr;
    }
  });
}

function impactedRuntimeServices(
  status: RuntimeHealthResponse | null | undefined,
  surface: ReadinessSurface,
): ReadinessService[] {
  if (!status?.degraded) {
    return [];
  }

  return servicesForSurface(surface).filter((service) => {
    switch (service) {
      case 'CATALOG':
        return status.services.catalog.degraded;
      case 'STASH':
        return status.services.stash.degraded;
      case 'WHISPARR':
        return status.services.whisparr.degraded;
    }
  });
}

function servicesForSurface(surface: ReadinessSurface): ReadinessService[] {
  switch (surface) {
    case 'home':
      return ['CATALOG', 'STASH', 'WHISPARR'];
    case 'scenes':
      return ['CATALOG', 'STASH', 'WHISPARR'];
    case 'library':
      return ['STASH'];
    case 'acquisition':
      return ['WHISPARR', 'STASH'];
  }
}

function alertForImpacts(
  surface: ReadinessSurface,
  impactedServices: ReadinessService[],
  source: 'setup' | 'runtime',
): ReadinessPageAlert {
  const eyebrow = source === 'setup' ? 'Repair Required' : 'Runtime Outage';
  const services = new Set(impactedServices);

  switch (surface) {
    case 'home':
      return {
        eyebrow,
        impactedServices,
        title: 'Home data is degraded',
        message:
          'One or more required integrations cannot provide rail data right now. Some Home rails may be empty or stale until integrations are repaired.',
      };
    case 'scenes':
      if (services.has('CATALOG')) {
        return {
          eyebrow,
          impactedServices,
          title: 'Catalog discovery needs attention',
          message:
            'Scenes depends on the configured catalog provider. Results may be empty or stale until the catalog integration is healthy again.',
        };
      }

      return {
        eyebrow,
        impactedServices,
        title: 'Scene status overlays are degraded',
        message:
          'Catalog browsing can continue, but Whisparr and Stash status badges may be stale until the affected integration is healthy again.',
      };
    case 'library':
      return {
        eyebrow,
        impactedServices,
        title:
          source === 'setup'
            ? 'Local library browsing needs attention'
            : 'Local library freshness is degraded',
        message:
          'Library depends on Stash. Newly imported scenes, artwork, local favorites, and availability overlays may be missing or stale until Stash is healthy again.',
      };
    case 'acquisition':
      if (services.has('WHISPARR') && services.has('STASH')) {
        return {
          eyebrow,
          impactedServices,
          title: 'Acquisition tracking is degraded',
          message:
            'Whisparr and Stash both affect this page. Request progress, failure states, and import visibility may be incomplete or stale until both recover.',
        };
      }

      if (services.has('WHISPARR')) {
        return {
          eyebrow,
          impactedServices,
          title: 'Whisparr needs attention',
          message:
            'Acquisition progress depends on Whisparr. Queue state, failures, and request progression may be stale until it is healthy again.',
        };
      }

      return {
        eyebrow,
        impactedServices,
        title: 'Stash import visibility is degraded',
        message:
          'Downloaded scenes may take longer to appear as imported while Stash is unhealthy. Repair integrations if import handoffs look stuck.',
      };
  }
}
