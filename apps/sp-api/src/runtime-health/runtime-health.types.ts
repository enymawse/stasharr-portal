import {
  RuntimeHealthServiceKey,
  RuntimeHealthStatus,
} from '@prisma/client';

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
