export type IndexingJobStatus = 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface IndexingJobStatusResponse {
  jobName: string;
  status: IndexingJobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  leaseUntil: string | null;
  cursor: string | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  processedCount: number | null;
  updatedCount: number | null;
  lastRunReason: string | null;
}

export interface IndexingStatusResponse {
  totals: {
    indexedScenes: number;
    acquisitionTrackedScenes: number;
    metadataBacklogScenes: number;
    metadataHydration: {
      pending: number;
      retryable: number;
    };
  };
  freshness: {
    indexStatusMaxAgeMs: number;
    requestRowsFresh: boolean;
    whisparrMoviesFresh: boolean;
    stashAvailabilityFresh: boolean;
    canResolveUnknownScenesAsNotRequested: boolean;
    lastIndexWriteAt: string | null;
    acquisitionCountsSource: string;
  };
  jobs: IndexingJobStatusResponse[];
}

export type ManualIndexingSyncJob = 'all' | 'queue' | 'movies' | 'library' | 'metadata';
