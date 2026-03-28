import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  MetadataHydrationState,
  Prisma,
  RequestStatus,
  SceneIndex,
  SceneLifecycle,
  SyncJobStatus,
} from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import {
  StashdbAdapter,
  StashdbSceneMetadata,
} from '../providers/stashdb/stashdb.adapter';
import {
  WhisparrAdapter,
  WhisparrAdapterBaseConfig,
  WhisparrMovieLookupResult,
  WhisparrQueueSnapshotItem,
} from '../providers/whisparr/whisparr.adapter';
import { SceneStatusDto } from '../scene-status/dto/scene-status.dto';
import {
  resolveSceneStatus,
  WhisparrQueueSnapshotItem as ResolverQueueItem,
} from '../scene-status/scene-status.resolver';
import { SyncStateService } from './sync-state.service';

export const INDEXING_JOB_NAMES = {
  BOOTSTRAP: 'scene-index-bootstrap',
  REQUEST_ROWS: 'scene-index-request-rows',
  WHISPARR_QUEUE: 'scene-index-whisparr-queue',
  WHISPARR_MOVIES: 'scene-index-whisparr-movies',
  STASH_AVAILABILITY: 'scene-index-stash-availability',
  METADATA_BACKFILL: 'scene-index-metadata-backfill',
} as const;

const ACQUISITION_LIFECYCLES: SceneLifecycle[] = [
  SceneLifecycle.REQUESTED,
  SceneLifecycle.DOWNLOADING,
  SceneLifecycle.IMPORT_PENDING,
  SceneLifecycle.FAILED,
];

const SCENE_INDEX_SUMMARY_KEY = 'GLOBAL';

export interface SceneIndexSummarySnapshot {
  indexedScenes: number;
  acquisitionTrackedScenes: number;
  requestedCount: number;
  downloadingCount: number;
  importPendingCount: number;
  failedCount: number;
  metadataPendingCount: number;
  metadataRetryableCount: number;
  lastIndexWriteAt: Date | null;
}

interface SceneIndexPatch {
  stashId: string;
  requestStatus?: RequestStatus | null;
  requestUpdatedAt?: Date | null;
  title?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  studioId?: string | null;
  studioName?: string | null;
  studioImageUrl?: string | null;
  releaseDate?: string | null;
  duration?: number | null;
  whisparrMovieId?: number | null;
  whisparrHasFile?: boolean | null;
  whisparrQueuePosition?: number | null;
  whisparrQueueStatus?: string | null;
  whisparrQueueState?: string | null;
  whisparrErrorMessage?: string | null;
  stashAvailable?: boolean | null;
  metadataHydrationState?: MetadataHydrationState;
  metadataLastSyncedAt?: Date | null;
  metadataRetryAfterAt?: Date | null;
  whisparrLastSyncedAt?: Date | null;
  stashLastSyncedAt?: Date | null;
  lastSyncedAt?: Date | null;
}

interface SyncRunSummary {
  processedCount: number;
  updatedCount: number;
  cursor?: string | null;
}

interface SceneIndexSummaryDelta {
  indexedScenes: number;
  acquisitionTrackedScenes: number;
  requestedCount: number;
  downloadingCount: number;
  importPendingCount: number;
  failedCount: number;
  metadataPendingCount: number;
  metadataRetryableCount: number;
  lastIndexWriteAt: Date | null;
}

type SceneIndexUpsertData = Prisma.SceneIndexUncheckedCreateInput & {
  stashId: string;
  computedLifecycle: SceneLifecycle;
  lifecycleSortOrder: number;
  metadataHydrationState: MetadataHydrationState;
};

@Injectable()
export class IndexingService {
  private static readonly INDEX_STATUS_MAX_AGE_MS = 30 * 60_000;
  private static readonly REQUEST_ROWS_FRESHNESS_MAX_AGE_MS = 2 * 60_000;
  private static readonly SNAPSHOT_FRESHNESS_MAX_AGE_MS = 20 * 60_000;
  private static readonly METADATA_REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
  private static readonly APPLY_PATCH_CHUNK_SIZE = 100;
  private static readonly WHISPARR_LOOKUP_BATCH_SIZE = 8;
  private static readonly STASH_LOOKUP_BATCH_SIZE = 6;
  private static readonly STASH_IDENTITY_PAGE_SIZE = 250;
  private static readonly METADATA_BATCH_SIZE = 24;
  private static readonly METADATA_QUERY_BATCH_SIZE = 8;
  private static readonly METADATA_ACCELERATED_INTERVAL_MS = 10_000;
  private static readonly METADATA_STEADY_INTERVAL_MS = 30 * 60_000;
  private static readonly METADATA_RETRY_BACKOFF_MS = 5 * 60_000;
  private static readonly UPSERT_DEADLOCK_RETRY_ATTEMPTS = 3;
  private static readonly BOOTSTRAP_LEASE_MS = 20 * 60_000;
  private static readonly QUEUE_LEASE_MS = 25_000;
  private static readonly MOVIES_LEASE_MS = 4 * 60_000;
  private static readonly STASH_LEASE_MS = 4 * 60_000;
  private static readonly METADATA_LEASE_MS = 20 * 60_000;

  private readonly logger = new Logger(IndexingService.name);
  private sceneIndexWriteBarrier: Promise<void> = Promise.resolve();
  private readonly metadataHydrationInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly stashAdapter: StashAdapter,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly syncStateService: SyncStateService,
  ) {}

  async bootstrapIndex(reason = 'startup'): Promise<SyncRunSummary | null> {
    return this.syncStateService.runWithLease(
      {
        jobName: INDEXING_JOB_NAMES.BOOTSTRAP,
        leaseMs: IndexingService.BOOTSTRAP_LEASE_MS,
        onSuccess: (result, context) => ({
          processedCount: result.processedCount,
          updatedCount: result.updatedCount,
          durationMs: context.durationMs,
          runReason: reason,
        }),
      },
      async () => {
        await this.ensureSceneIndexSummary();

        if (!(await this.shouldBootstrap())) {
          this.logger.debug(`Bootstrap skipped for reason=${reason}.`);
          return {
            processedCount: 0,
            updatedCount: 0,
          };
        }

        this.logger.log(`Starting bootstrap scene indexing. reason=${reason}`);
        const requestRows = await this.syncRequestRows();
        const movieResult = await this.syncWhisparrMovies(
          `${reason}:bootstrap`,
          true,
        );
        const queueResult = await this.syncWhisparrQueue(
          `${reason}:bootstrap`,
          true,
        );
        const stashResult = await this.syncStashAvailability(
          `${reason}:bootstrap`,
          undefined,
          true,
        );
        const metadataResult = await this.syncMetadataBackfill(
          `${reason}:bootstrap`,
          true,
        );

        return {
          processedCount:
            requestRows.length +
            (movieResult?.processedCount ?? 0) +
            (queueResult?.processedCount ?? 0) +
            (stashResult?.processedCount ?? 0) +
            (metadataResult?.processedCount ?? 0),
          updatedCount:
            requestRows.length +
            (movieResult?.updatedCount ?? 0) +
            (queueResult?.updatedCount ?? 0) +
            (stashResult?.updatedCount ?? 0) +
            (metadataResult?.updatedCount ?? 0),
        };
      },
    );
  }

  async syncWhisparrQueue(
    reason = 'scheduled',
    skipRequestSync = false,
  ): Promise<SyncRunSummary | null> {
    return this.syncStateService.runWithLease(
      {
        jobName: INDEXING_JOB_NAMES.WHISPARR_QUEUE,
        leaseMs: IndexingService.QUEUE_LEASE_MS,
        onSuccess: (result, context) => ({
          processedCount: result.processedCount,
          updatedCount: result.updatedCount,
          durationMs: context.durationMs,
          runReason: reason,
        }),
      },
      async () => this.performWhisparrQueueSync(reason, skipRequestSync),
    );
  }

  async syncWhisparrMovies(
    reason = 'scheduled',
    skipRequestSync = false,
  ): Promise<SyncRunSummary | null> {
    return this.syncStateService.runWithLease(
      {
        jobName: INDEXING_JOB_NAMES.WHISPARR_MOVIES,
        leaseMs: IndexingService.MOVIES_LEASE_MS,
        onSuccess: (result, context) => ({
          processedCount: result.processedCount,
          updatedCount: result.updatedCount,
          durationMs: context.durationMs,
          runReason: reason,
        }),
      },
      async () => this.performWhisparrMovieSync(reason, skipRequestSync),
    );
  }

  async syncStashAvailability(
    reason = 'scheduled',
    stashIds?: string[],
    forceFullPass = false,
  ): Promise<SyncRunSummary | null> {
    return this.syncStateService.runWithLease(
      {
        jobName: INDEXING_JOB_NAMES.STASH_AVAILABILITY,
        leaseMs: IndexingService.STASH_LEASE_MS,
        onSuccess: (result, context) => ({
          processedCount: result.processedCount,
          updatedCount: result.updatedCount,
          durationMs: context.durationMs,
          runReason: reason,
        }),
      },
      async () =>
        this.performStashAvailabilitySync(reason, stashIds, forceFullPass),
    );
  }

  async syncMetadataBackfill(
    reason = 'scheduled',
    forceBootstrapPass = false,
  ): Promise<SyncRunSummary | null> {
    if (
      !forceBootstrapPass &&
      reason === 'interval' &&
      !(await this.shouldRunScheduledMetadataBackfill())
    ) {
      return null;
    }

    return this.syncStateService.runWithLease(
      {
        jobName: INDEXING_JOB_NAMES.METADATA_BACKFILL,
        leaseMs: IndexingService.METADATA_LEASE_MS,
        onSuccess: (result, context) => ({
          cursor: result.cursor,
          processedCount: result.processedCount,
          updatedCount: result.updatedCount,
          durationMs: context.durationMs,
          runReason: reason,
        }),
      },
      async () => this.performMetadataBackfill(reason, forceBootstrapPass),
    );
  }

  async hydrateMetadataForStashIds(
    stashIds: string[],
    reason = 'on-demand',
  ): Promise<Map<string, SceneIndex>> {
    const normalizedIds = this.normalizeStashIds(stashIds);
    if (normalizedIds.length === 0) {
      return new Map();
    }

    await this.performMetadataHydration(reason, normalizedIds);
    return this.getSceneIndexRows(normalizedIds);
  }

  requestMetadataHydrationForStashIds(
    stashIds: string[],
    reason = 'on-demand',
  ): void {
    const normalizedIds = this.normalizeStashIds(stashIds).filter(
      (stashId) => !this.metadataHydrationInFlight.has(stashId),
    );
    if (normalizedIds.length === 0) {
      return;
    }

    void this.performMetadataHydration(reason, normalizedIds).catch((error) => {
      this.logger.warn(
        `Background metadata hydration failed. reason=${reason} error=${this.safeJson(
          this.serializeError(error),
        )}`,
      );
    });
  }

  async seedRequestedScene(input: {
    stashId: string;
    requestStatus: RequestStatus;
    requestUpdatedAt: Date;
    title: string | null;
    description: string | null;
    imageUrl: string | null;
    studioId: string | null;
    studioName: string | null;
    studioImageUrl: string | null;
    releaseDate: string | null;
    duration: number | null;
    whisparrMovieId?: number | null;
    whisparrHasFile?: boolean | null;
  }): Promise<void> {
    const stashId = input.stashId.trim();
    if (!stashId) {
      return;
    }

    const now = new Date();
    await this.applySceneIndexPatches([
      {
        stashId,
        requestStatus: input.requestStatus,
        requestUpdatedAt: input.requestUpdatedAt,
        title: input.title,
        description: input.description,
        imageUrl: input.imageUrl,
        studioId: input.studioId,
        studioName: input.studioName,
        studioImageUrl: input.studioImageUrl,
        releaseDate: input.releaseDate,
        duration: input.duration,
        metadataHydrationState: MetadataHydrationState.HYDRATED,
        metadataLastSyncedAt: now,
        metadataRetryAfterAt: null,
        whisparrMovieId: input.whisparrMovieId,
        whisparrHasFile: input.whisparrHasFile,
        whisparrLastSyncedAt:
          input.whisparrMovieId !== undefined ? now : undefined,
        lastSyncedAt: now,
      },
    ]);
  }

  async requestImmediateRefresh(
    stashIds: string[],
    reason = 'manual',
  ): Promise<void> {
    const normalizedIds = this.normalizeStashIds(stashIds);
    if (normalizedIds.length === 0) {
      return;
    }

    await this.syncRequestRows(normalizedIds);

    const results = await Promise.allSettled([
      this.refreshWhisparrMoviesForStashIds(
        normalizedIds,
        `${reason}:whisparr-targeted`,
      ),
      this.refreshStashAvailabilityForStashIds(
        normalizedIds,
        `${reason}:stash-targeted`,
      ),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Priority scene refresh failed. reason=${reason} error=${this.safeJson(
            this.serializeError(result.reason),
          )}`,
        );
      }
    }

    const rows = await this.getSceneIndexRows(normalizedIds);
    const pendingMetadataIds = normalizedIds.filter((stashId) =>
      this.shouldHydrateMetadataNow(rows.get(stashId) ?? null),
    );

    if (pendingMetadataIds.length > 0) {
      this.requestMetadataHydrationForStashIds(
        pendingMetadataIds,
        `${reason}:metadata-targeted`,
      );
    }
  }

  async runManualSync(job?: string): Promise<void> {
    if (!job || job === 'all') {
      await this.bootstrapIndex('manual');
      await this.syncWhisparrMovies('manual');
      await this.syncWhisparrQueue('manual');
      await this.syncStashAvailability('manual');
      await this.syncMetadataBackfill('manual');
      return;
    }

    switch (job) {
      case 'bootstrap':
        await this.bootstrapIndex('manual');
        return;
      case 'queue':
        await this.syncWhisparrQueue('manual');
        return;
      case 'movies':
        await this.syncWhisparrMovies('manual');
        return;
      case 'stash':
        await this.syncStashAvailability('manual');
        return;
      case 'metadata':
        await this.syncMetadataBackfill('manual');
        return;
      default:
        throw new BadRequestException(`Unsupported sync job: ${job}`);
    }
  }

  async getSceneIndexSummary(): Promise<SceneIndexSummarySnapshot> {
    let summary = await this.prisma.sceneIndexSummary.findUnique({
      where: {
        key: SCENE_INDEX_SUMMARY_KEY,
      },
    });
    if (!summary) {
      await this.rebuildSceneIndexSummary();
      summary = await this.prisma.sceneIndexSummary.findUnique({
        where: {
          key: SCENE_INDEX_SUMMARY_KEY,
        },
      });
    }

    return {
      indexedScenes: summary?.indexedScenes ?? 0,
      acquisitionTrackedScenes: summary?.acquisitionTrackedScenes ?? 0,
      requestedCount: summary?.requestedCount ?? 0,
      downloadingCount: summary?.downloadingCount ?? 0,
      importPendingCount: summary?.importPendingCount ?? 0,
      failedCount: summary?.failedCount ?? 0,
      metadataPendingCount: summary?.metadataPendingCount ?? 0,
      metadataRetryableCount: summary?.metadataRetryableCount ?? 0,
      lastIndexWriteAt: summary?.lastIndexWriteAt ?? null,
    };
  }

  async getSyncStatus() {
    const [jobs, summary] = await Promise.all([
      this.prisma.syncState.findMany({
        orderBy: {
          jobName: 'asc',
        },
      }),
      this.getSceneIndexSummary(),
    ]);
    const jobByName = new Map(jobs.map((job) => [job.jobName, job]));
    const metadataBacklogScenes =
      summary.metadataPendingCount + summary.metadataRetryableCount;

    return {
      totals: {
        indexedScenes: summary.indexedScenes,
        acquisitionTrackedScenes: summary.acquisitionTrackedScenes,
        metadataBacklogScenes,
        metadataHydration: {
          pending: summary.metadataPendingCount,
          retryable: summary.metadataRetryableCount,
        },
      },
      freshness: {
        indexStatusMaxAgeMs: IndexingService.INDEX_STATUS_MAX_AGE_MS,
        requestRowsFresh: this.isSuccessfulSyncFresh(
          jobByName.get(INDEXING_JOB_NAMES.REQUEST_ROWS) ?? null,
          IndexingService.REQUEST_ROWS_FRESHNESS_MAX_AGE_MS,
        ),
        whisparrMoviesFresh: this.isSuccessfulSyncFresh(
          jobByName.get(INDEXING_JOB_NAMES.WHISPARR_MOVIES) ?? null,
          IndexingService.SNAPSHOT_FRESHNESS_MAX_AGE_MS,
        ),
        stashAvailabilityFresh: this.isSuccessfulSyncFresh(
          jobByName.get(INDEXING_JOB_NAMES.STASH_AVAILABILITY) ?? null,
          IndexingService.SNAPSHOT_FRESHNESS_MAX_AGE_MS,
        ),
        canResolveUnknownScenesAsNotRequested:
          await this.canResolveUnknownScenesAsNotRequested(),
        lastIndexWriteAt: summary.lastIndexWriteAt?.toISOString() ?? null,
        acquisitionCountsSource: 'scene-index-summary',
      },
      jobs: jobs.map((job) => ({
        jobName: job.jobName,
        status: job.status,
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        leaseUntil: job.leaseUntil?.toISOString() ?? null,
        cursor: job.cursor,
        lastError: job.lastError,
        lastSuccessAt: job.lastSuccessAt?.toISOString() ?? null,
        lastDurationMs: job.lastDurationMs ?? null,
        processedCount: job.lastProcessedCount ?? null,
        updatedCount: job.lastUpdatedCount ?? null,
        lastRunReason: job.lastRunReason ?? null,
      })),
    };
  }

  async getSceneIndexRows(
    stashIds: string[],
  ): Promise<Map<string, SceneIndex>> {
    const normalizedIds = this.normalizeStashIds(stashIds);
    if (normalizedIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.sceneIndex.findMany({
      where: {
        stashId: {
          in: normalizedIds,
        },
      },
    });

    return new Map(rows.map((row) => [row.stashId, row]));
  }

  async getFreshSceneIndexRows(
    stashIds: string[],
  ): Promise<Map<string, SceneIndex>> {
    const rows = await this.getSceneIndexRows(stashIds);
    const usableRows = new Map<string, SceneIndex>();

    for (const [stashId, row] of rows.entries()) {
      if (this.isIndexedStatusUsable(row)) {
        usableRows.set(stashId, row);
      }
    }

    return usableRows;
  }

  toSceneStatus(row: Pick<SceneIndex, 'computedLifecycle'>): SceneStatusDto {
    return {
      state: row.computedLifecycle as SceneStatusDto['state'],
    };
  }

  isIndexedStatusUsable(row: SceneIndex): boolean {
    if (!row.lastSyncedAt) {
      return false;
    }

    return (
      Date.now() - row.lastSyncedAt.getTime() <=
      IndexingService.INDEX_STATUS_MAX_AGE_MS
    );
  }

  async canResolveUnknownScenesAsNotRequested(): Promise<boolean> {
    const [hasWhisparr, hasStash, states] = await Promise.all([
      this.isIntegrationConfigured(IntegrationType.WHISPARR),
      this.isIntegrationConfigured(IntegrationType.STASH),
      this.prisma.syncState.findMany({
        where: {
          jobName: {
            in: [
              INDEXING_JOB_NAMES.REQUEST_ROWS,
              INDEXING_JOB_NAMES.WHISPARR_MOVIES,
              INDEXING_JOB_NAMES.STASH_AVAILABILITY,
            ],
          },
        },
      }),
    ]);

    const stateByJobName = new Map(
      states.map((state) => [state.jobName, state]),
    );

    return (
      this.isSuccessfulSyncFresh(
        stateByJobName.get(INDEXING_JOB_NAMES.REQUEST_ROWS) ?? null,
        IndexingService.REQUEST_ROWS_FRESHNESS_MAX_AGE_MS,
      ) &&
      (!hasWhisparr ||
        this.isSuccessfulSyncFresh(
          stateByJobName.get(INDEXING_JOB_NAMES.WHISPARR_MOVIES) ?? null,
          IndexingService.SNAPSHOT_FRESHNESS_MAX_AGE_MS,
        )) &&
      (!hasStash ||
        this.isSuccessfulSyncFresh(
          stateByJobName.get(INDEXING_JOB_NAMES.STASH_AVAILABILITY) ?? null,
          IndexingService.SNAPSHOT_FRESHNESS_MAX_AGE_MS,
        ))
    );
  }

  private async refreshWhisparrMoviesForStashIds(
    stashIds: string[],
    reason: string,
  ): Promise<SyncRunSummary> {
    const config = await this.getWhisparrConfig();
    if (!config) {
      return {
        processedCount: 0,
        updatedCount: 0,
      };
    }

    const normalizedIds = this.normalizeStashIds(stashIds);
    if (normalizedIds.length === 0) {
      return {
        processedCount: 0,
        updatedCount: 0,
      };
    }

    const now = new Date();
    const patches: SceneIndexPatch[] = [];

    for (
      let i = 0;
      i < normalizedIds.length;
      i += IndexingService.WHISPARR_LOOKUP_BATCH_SIZE
    ) {
      const batch = normalizedIds.slice(
        i,
        i + IndexingService.WHISPARR_LOOKUP_BATCH_SIZE,
      );
      const results = await Promise.all(
        batch.map(async (stashId) => {
          try {
            const movie = await this.whisparrAdapter.findMovieByStashId(
              stashId,
              config,
            );
            return {
              stashId,
              movie,
            };
          } catch (error) {
            this.logger.warn(
              `Targeted Whisparr lookup failed. reason=${reason} stashId=${stashId} error=${this.safeJson(
                this.serializeError(error),
              )}`,
            );
            return {
              stashId,
              movie: null,
            };
          }
        }),
      );

      for (const result of results) {
        if (!result.movie) {
          continue;
        }

        patches.push({
          stashId: result.stashId,
          whisparrMovieId: result.movie.movieId,
          whisparrHasFile: result.movie.hasFile,
          whisparrQueuePosition: result.movie.hasFile ? null : undefined,
          whisparrQueueStatus: result.movie.hasFile ? null : undefined,
          whisparrQueueState: result.movie.hasFile ? null : undefined,
          whisparrErrorMessage: result.movie.hasFile ? null : undefined,
          whisparrLastSyncedAt: now,
          lastSyncedAt: now,
        });
      }
    }

    await this.applySceneIndexPatches(patches);
    this.logger.debug(
      `Targeted Whisparr refresh completed: ${this.safeJson({
        reason,
        requestedIds: normalizedIds.length,
        updated: patches.length,
      })}`,
    );

    return {
      processedCount: normalizedIds.length,
      updatedCount: patches.length,
    };
  }

  private async refreshStashAvailabilityForStashIds(
    stashIds: string[],
    reason: string,
  ): Promise<SyncRunSummary> {
    const config = await this.getStashConfig();
    if (!config) {
      return {
        processedCount: 0,
        updatedCount: 0,
      };
    }

    const normalizedIds = this.normalizeStashIds(stashIds);
    if (normalizedIds.length === 0) {
      return {
        processedCount: 0,
        updatedCount: 0,
      };
    }

    const now = new Date();
    const patches: SceneIndexPatch[] = [];

    for (
      let i = 0;
      i < normalizedIds.length;
      i += IndexingService.STASH_LOOKUP_BATCH_SIZE
    ) {
      const batch = normalizedIds.slice(
        i,
        i + IndexingService.STASH_LOOKUP_BATCH_SIZE,
      );
      const results = await Promise.all(
        batch.map(async (stashId) => {
          try {
            const matches = await this.stashAdapter.findScenesByStashId(
              stashId,
              config,
            );
            return {
              stashId,
              stashAvailable: matches.length > 0,
            };
          } catch (error) {
            this.logger.warn(
              `Targeted Stash availability lookup failed. reason=${reason} stashId=${stashId} error=${this.safeJson(
                this.serializeError(error),
              )}`,
            );
            return null;
          }
        }),
      );

      for (const result of results) {
        if (!result) {
          continue;
        }

        patches.push({
          stashId: result.stashId,
          stashAvailable: result.stashAvailable,
          stashLastSyncedAt: now,
          lastSyncedAt: now,
        });
      }
    }

    await this.applySceneIndexPatches(patches);
    this.logger.debug(
      `Targeted Stash refresh completed: ${this.safeJson({
        reason,
        requestedIds: normalizedIds.length,
        updated: patches.length,
      })}`,
    );

    return {
      processedCount: normalizedIds.length,
      updatedCount: patches.length,
    };
  }

  private async shouldBootstrap(): Promise<boolean> {
    const [indexedCount, unsyncedCount, requestCount] = await Promise.all([
      this.prisma.sceneIndex.count(),
      this.prisma.sceneIndex.count({
        where: {
          lastSyncedAt: null,
        },
      }),
      this.prisma.request.count(),
    ]);

    if (requestCount > indexedCount) {
      return true;
    }

    if (unsyncedCount > 0) {
      return true;
    }

    if (indexedCount > 0) {
      return false;
    }

    const hasWhisparr = await this.isIntegrationConfigured(
      IntegrationType.WHISPARR,
    );
    const hasStash = await this.isIntegrationConfigured(IntegrationType.STASH);

    return requestCount > 0 || hasWhisparr || hasStash;
  }

  private async performWhisparrMovieSync(
    reason: string,
    skipRequestSync: boolean,
  ): Promise<SyncRunSummary> {
    if (!skipRequestSync) {
      await this.syncRequestRows();
    }

    const config = await this.getWhisparrConfig();
    if (!config) {
      return {
        processedCount: 0,
        updatedCount: 0,
      };
    }

    const now = new Date();
    const movies = await this.whisparrAdapter.getMovieSnapshot(config);
    const snapshotMovieIds = new Set<number>();
    const patches: SceneIndexPatch[] = [];

    for (const movie of movies) {
      snapshotMovieIds.add(movie.movieId);
      patches.push({
        stashId: movie.stashId,
        whisparrMovieId: movie.movieId,
        whisparrHasFile: movie.hasFile,
        whisparrLastSyncedAt: now,
        lastSyncedAt: now,
      });
    }

    const staleRows = await this.prisma.sceneIndex.findMany({
      where: snapshotMovieIds.size
        ? {
            whisparrMovieId: {
              notIn: Array.from(snapshotMovieIds),
            },
          }
        : {
            whisparrMovieId: {
              not: null,
            },
          },
      select: {
        stashId: true,
      },
    });

    for (const row of staleRows) {
      patches.push({
        stashId: row.stashId,
        whisparrMovieId: null,
        whisparrHasFile: null,
        whisparrQueuePosition: null,
        whisparrQueueStatus: null,
        whisparrQueueState: null,
        whisparrErrorMessage: null,
        whisparrLastSyncedAt: now,
        lastSyncedAt: now,
      });
    }

    await this.applySceneIndexPatches(patches);
    this.logger.debug(
      `Whisparr movie sync completed: ${this.safeJson({
        reason,
        movies: movies.length,
        staleRows: staleRows.length,
      })}`,
    );

    return {
      processedCount: movies.length + staleRows.length,
      updatedCount: patches.length,
    };
  }

  private async performWhisparrQueueSync(
    reason: string,
    skipRequestSync: boolean,
  ): Promise<SyncRunSummary> {
    if (!skipRequestSync) {
      await this.syncRequestRows();
    }

    const config = await this.getWhisparrConfig();
    if (!config) {
      return {
        processedCount: 0,
        updatedCount: 0,
      };
    }

    const now = new Date();
    const queueItems = await this.whisparrAdapter.getQueueSnapshot(config);
    const groupedByMovieId = this.groupQueueItemsByMovieId(queueItems);
    const movieIds = Array.from(groupedByMovieId.keys());
    const existingRows = movieIds.length
      ? await this.prisma.sceneIndex.findMany({
          where: {
            whisparrMovieId: {
              in: movieIds,
            },
          },
        })
      : [];
    const existingByMovieId = new Map<number, SceneIndex>();

    for (const row of existingRows) {
      if (
        row.whisparrMovieId !== null &&
        !existingByMovieId.has(row.whisparrMovieId)
      ) {
        existingByMovieId.set(row.whisparrMovieId, row);
      }
    }

    const missingMovieIds = movieIds.filter(
      (movieId) => !existingByMovieId.has(movieId),
    );
    const lookedUpMovies = await this.lookupWhisparrMoviesById(
      missingMovieIds,
      config,
    );

    const patches: SceneIndexPatch[] = [];
    const queueItemsByStashId = new Map<string, ResolverQueueItem[]>();
    const seenQueueStashIds = new Set<string>();

    for (const movieId of movieIds) {
      const row = existingByMovieId.get(movieId) ?? null;
      const movie =
        (row
          ? {
              movieId,
              stashId: row.stashId,
              hasFile: row.whisparrHasFile === true,
            }
          : null) ??
        lookedUpMovies.get(movieId) ??
        null;

      if (!movie) {
        this.logger.warn(
          `Skipping queue item without stashId mapping: ${movieId}`,
        );
        continue;
      }

      const stashId = movie.stashId;
      const groupedItems = groupedByMovieId.get(movieId) ?? [];
      queueItemsByStashId.set(stashId, groupedItems);
      const queueSummary = this.summarizeQueueItems(groupedItems);
      const queuePosition = seenQueueStashIds.size;

      if (!seenQueueStashIds.has(stashId)) {
        seenQueueStashIds.add(stashId);
      }

      patches.push({
        stashId,
        whisparrMovieId: movie.movieId,
        whisparrHasFile: movie.hasFile,
        whisparrQueuePosition: queuePosition,
        whisparrQueueStatus: queueSummary.status,
        whisparrQueueState: queueSummary.state,
        whisparrErrorMessage: queueSummary.errorMessage,
        whisparrLastSyncedAt: now,
        lastSyncedAt: now,
      });
    }

    const clearedQueueRows = await this.prisma.sceneIndex.findMany({
      where: movieIds.length
        ? {
            OR: [
              {
                whisparrQueueStatus: {
                  not: null,
                },
              },
              {
                whisparrQueuePosition: {
                  not: null,
                },
              },
            ],
            whisparrMovieId: {
              notIn: movieIds,
            },
          }
        : {
            OR: [
              {
                whisparrQueueStatus: {
                  not: null,
                },
              },
              {
                whisparrQueuePosition: {
                  not: null,
                },
              },
            ],
          },
      select: {
        stashId: true,
      },
    });

    for (const row of clearedQueueRows) {
      patches.push({
        stashId: row.stashId,
        whisparrQueuePosition: null,
        whisparrQueueStatus: null,
        whisparrQueueState: null,
        whisparrErrorMessage: null,
        whisparrLastSyncedAt: now,
        lastSyncedAt: now,
      });
    }

    await this.applySceneIndexPatches(patches, queueItemsByStashId);
    this.logger.debug(
      `Whisparr queue sync completed: ${this.safeJson({
        reason,
        queueItems: queueItems.length,
        mappedScenes: queueItemsByStashId.size,
        clearedQueueRows: clearedQueueRows.length,
      })}`,
    );

    return {
      processedCount: queueItems.length + clearedQueueRows.length,
      updatedCount: patches.length,
    };
  }

  private async performStashAvailabilitySync(
    reason: string,
    stashIds?: string[],
    forceFullPass = false,
  ): Promise<SyncRunSummary> {
    const config = await this.getStashConfig();
    if (!config) {
      return {
        processedCount: 0,
        updatedCount: 0,
      };
    }

    const now = new Date();
    const targetedIds =
      stashIds && stashIds.length > 0 ? this.normalizeStashIds(stashIds) : null;
    const fullReconciliation = forceFullPass || targetedIds === null;
    const snapshot = await this.collectLocalStashIdentitySnapshot(config);
    const patches: SceneIndexPatch[] = [];

    for (const stashId of targetedIds ?? snapshot.availableStashIds) {
      patches.push({
        stashId,
        stashAvailable: snapshot.availableStashIds.has(stashId),
        stashLastSyncedAt: now,
        lastSyncedAt: now,
      });
    }

    if (fullReconciliation) {
      const previouslyAvailableRows = await this.prisma.sceneIndex.findMany({
        where: {
          stashAvailable: true,
        },
        select: {
          stashId: true,
        },
      });

      for (const row of previouslyAvailableRows) {
        if (snapshot.availableStashIds.has(row.stashId)) {
          continue;
        }

        patches.push({
          stashId: row.stashId,
          stashAvailable: false,
          stashLastSyncedAt: now,
          lastSyncedAt: now,
        });
      }
    }

    await this.applySceneIndexPatches(patches);
    this.logger.debug(
      `Stash availability sync completed: ${this.safeJson({
        reason,
        localSceneCount: snapshot.localSceneCount,
        indexedAvailableIds: snapshot.availableStashIds.size,
        targetedIds: targetedIds?.length ?? null,
        updated: patches.length,
      })}`,
    );

    return {
      processedCount: snapshot.localSceneCount,
      updatedCount: this.mergePatchesByStashId(patches).length,
    };
  }

  private async performMetadataBackfill(
    reason: string,
    forceBootstrapPass: boolean,
  ): Promise<SyncRunSummary> {
    const cursorState = await this.prisma.syncState.findUnique({
      where: {
        jobName: INDEXING_JOB_NAMES.METADATA_BACKFILL,
      },
      select: {
        cursor: true,
      },
    });

    const targetRows = await this.getMetadataBackfillTargets(
      cursorState?.cursor ?? null,
      forceBootstrapPass,
    );
    if (targetRows.length === 0) {
      return {
        processedCount: 0,
        updatedCount: 0,
        cursor: null,
      };
    }

    await this.performMetadataHydration(
      reason,
      targetRows.map((row) => row.stashId),
    );

    return {
      processedCount: targetRows.length,
      updatedCount: targetRows.length,
      cursor: targetRows[targetRows.length - 1]?.stashId ?? null,
    };
  }

  private async performMetadataHydration(
    reason: string,
    stashIds: string[],
  ): Promise<void> {
    const config = await this.getStashdbConfig();
    if (!config) {
      return;
    }

    const normalizedIds = this.normalizeStashIds(stashIds);
    if (normalizedIds.length === 0) {
      return;
    }

    const claimedIds = normalizedIds.filter((stashId) => {
      if (this.metadataHydrationInFlight.has(stashId)) {
        return false;
      }

      this.metadataHydrationInFlight.add(stashId);
      return true;
    });
    if (claimedIds.length === 0) {
      return;
    }

    try {
      const patches: SceneIndexPatch[] = [];

      for (
        let i = 0;
        i < claimedIds.length;
        i += IndexingService.METADATA_QUERY_BATCH_SIZE
      ) {
        const batch = claimedIds.slice(
          i,
          i + IndexingService.METADATA_QUERY_BATCH_SIZE,
        );
        const now = new Date();
        let batchMetadata: StashdbSceneMetadata[];
        try {
          batchMetadata = await this.stashdbAdapter.getSceneMetadataByIds(
            batch,
            config,
          );
        } catch (error) {
          this.logger.warn(
            `Metadata hydration batch failed. reason=${reason} stashIds=${this.safeJson(
              batch,
            )} error=${this.safeJson(this.serializeError(error))}`,
          );
          const retryAfterAt = new Date(
            now.getTime() + IndexingService.METADATA_RETRY_BACKOFF_MS,
          );
          for (const stashId of batch) {
            patches.push({
              stashId,
              metadataHydrationState: MetadataHydrationState.FAILED_RETRYABLE,
              metadataRetryAfterAt: retryAfterAt,
            });
          }
          continue;
        }

        for (const scene of batchMetadata) {
          patches.push(this.buildMetadataPatchFromScene(scene, now));
        }

        const hydratedIds = new Set(batchMetadata.map((scene) => scene.id));
        for (const stashId of batch) {
          if (!hydratedIds.has(stashId)) {
            patches.push({
              stashId,
              metadataHydrationState: MetadataHydrationState.HYDRATED,
              metadataLastSyncedAt: now,
              metadataRetryAfterAt: null,
              lastSyncedAt: now,
            });
          }
        }
      }

      await this.applySceneIndexPatches(patches);
    } finally {
      for (const stashId of claimedIds) {
        this.metadataHydrationInFlight.delete(stashId);
      }
    }
  }

  private async syncRequestRows(stashIds?: string[]): Promise<string[]> {
    const normalizedIds =
      stashIds && stashIds.length > 0 ? this.normalizeStashIds(stashIds) : null;
    const isFullSync = normalizedIds === null;
    const requestRows = await this.prisma.request.findMany({
      where: normalizedIds
        ? {
            stashId: {
              in: normalizedIds,
            },
          }
        : undefined,
      select: {
        stashId: true,
        status: true,
        updatedAt: true,
      },
    });

    const now = new Date();
    if (requestRows.length > 0) {
      await this.applySceneIndexPatches(
        requestRows.map((requestRow) => ({
          stashId: requestRow.stashId,
          requestStatus: requestRow.status,
          requestUpdatedAt: requestRow.updatedAt,
          lastSyncedAt: now,
        })),
      );
    }

    if (isFullSync) {
      await this.syncStateService.recordSuccess(
        INDEXING_JOB_NAMES.REQUEST_ROWS,
        {
          processedCount: requestRows.length,
          updatedCount: requestRows.length,
          runReason: 'request-sync',
        },
      );
    }

    return requestRows.map((requestRow) => requestRow.stashId);
  }

  private async applySceneIndexPatches(
    patches: SceneIndexPatch[],
    queueItemsByStashId?: Map<string, ResolverQueueItem[]>,
  ): Promise<void> {
    await this.withSceneIndexWriteBarrier(async () => {
      const mergedPatches = this.mergePatchesByStashId(patches).sort(
        (left, right) => left.stashId.localeCompare(right.stashId),
      );
      if (mergedPatches.length === 0) {
        return;
      }

      await this.ensureSceneIndexSummary();

      const existingRows = await this.prisma.sceneIndex.findMany({
        where: {
          stashId: {
            in: mergedPatches.map((patch) => patch.stashId),
          },
        },
      });
      const existingByStashId = new Map(
        existingRows.map((row) => [row.stashId, row]),
      );

      for (
        let i = 0;
        i < mergedPatches.length;
        i += IndexingService.APPLY_PATCH_CHUNK_SIZE
      ) {
        const chunk = mergedPatches.slice(
          i,
          i + IndexingService.APPLY_PATCH_CHUNK_SIZE,
        );
        await this.executePatchChunk(
          chunk,
          existingByStashId,
          queueItemsByStashId,
        );
      }
    });
  }

  private async executePatchChunk(
    chunk: SceneIndexPatch[],
    existingByStashId: Map<string, SceneIndex>,
    queueItemsByStashId?: Map<string, ResolverQueueItem[]>,
  ): Promise<void> {
    for (
      let attempt = 1;
      attempt <= IndexingService.UPSERT_DEADLOCK_RETRY_ATTEMPTS;
      attempt += 1
    ) {
      try {
        const nextRows = chunk.map((patch) =>
          this.buildSceneIndexUpsertData(
            existingByStashId.get(patch.stashId) ?? null,
            patch,
            queueItemsByStashId?.get(patch.stashId),
          ),
        );
        const transactionOperations: Prisma.PrismaPromise<unknown>[] =
          nextRows.map((data) =>
            this.prisma.sceneIndex.upsert({
              where: {
                stashId: data.stashId,
              },
              create: data,
              update: data,
            }),
          );
        const summaryDelta = this.buildSceneIndexSummaryDelta(
          chunk,
          nextRows,
          existingByStashId,
        );

        if (this.hasSummaryDelta(summaryDelta)) {
          transactionOperations.push(
            this.prisma.sceneIndexSummary.update({
              where: {
                key: SCENE_INDEX_SUMMARY_KEY,
              },
              data: this.buildSceneIndexSummaryDeltaUpdate(summaryDelta),
            }),
          );
        }

        await this.prisma.$transaction(transactionOperations);

        for (const row of nextRows) {
          existingByStashId.set(row.stashId, row as SceneIndex);
        }
        return;
      } catch (error) {
        if (
          !this.isDeadlockError(error) ||
          attempt >= IndexingService.UPSERT_DEADLOCK_RETRY_ATTEMPTS
        ) {
          throw error;
        }

        this.logger.warn(
          `Retrying deadlocked scene-index patch batch: ${this.safeJson({
            attempt,
            stashIds: chunk.map((patch) => patch.stashId),
          })}`,
        );
        await this.sleep(50 * attempt);
      }
    }
  }

  private buildSceneIndexUpsertData(
    existing: SceneIndex | null,
    patch: SceneIndexPatch,
    queueItems?: ResolverQueueItem[],
  ): SceneIndexUpsertData {
    const merged: SceneIndexUpsertData = {
      stashId: patch.stashId,
      requestStatus: this.pickValue(
        patch.requestStatus,
        existing?.requestStatus ?? null,
      ),
      requestUpdatedAt: this.pickValue(
        patch.requestUpdatedAt,
        existing?.requestUpdatedAt ?? null,
      ),
      title: this.pickValue(patch.title, existing?.title ?? null),
      description: this.pickValue(
        patch.description,
        existing?.description ?? null,
      ),
      imageUrl: this.pickValue(patch.imageUrl, existing?.imageUrl ?? null),
      studioId: this.pickValue(patch.studioId, existing?.studioId ?? null),
      studioName: this.pickValue(
        patch.studioName,
        existing?.studioName ?? null,
      ),
      studioImageUrl: this.pickValue(
        patch.studioImageUrl,
        existing?.studioImageUrl ?? null,
      ),
      releaseDate: this.pickValue(
        patch.releaseDate,
        existing?.releaseDate ?? null,
      ),
      duration: this.pickValue(patch.duration, existing?.duration ?? null),
      whisparrMovieId: this.pickValue(
        patch.whisparrMovieId,
        existing?.whisparrMovieId ?? null,
      ),
      whisparrHasFile: this.pickValue(
        patch.whisparrHasFile,
        existing?.whisparrHasFile ?? null,
      ),
      whisparrQueuePosition: this.pickValue(
        patch.whisparrQueuePosition,
        existing?.whisparrQueuePosition ?? null,
      ),
      whisparrQueueStatus: this.pickValue(
        patch.whisparrQueueStatus,
        existing?.whisparrQueueStatus ?? null,
      ),
      whisparrQueueState: this.pickValue(
        patch.whisparrQueueState,
        existing?.whisparrQueueState ?? null,
      ),
      whisparrErrorMessage: this.pickValue(
        patch.whisparrErrorMessage,
        existing?.whisparrErrorMessage ?? null,
      ),
      stashAvailable: this.pickValue(
        patch.stashAvailable,
        existing?.stashAvailable ?? null,
      ),
      metadataHydrationState: this.pickValue(
        patch.metadataHydrationState,
        existing?.metadataHydrationState ?? MetadataHydrationState.PENDING,
      ),
      metadataLastSyncedAt: this.pickValue(
        patch.metadataLastSyncedAt,
        existing?.metadataLastSyncedAt ?? null,
      ),
      metadataRetryAfterAt: this.pickValue(
        patch.metadataRetryAfterAt,
        existing?.metadataRetryAfterAt ?? null,
      ),
      whisparrLastSyncedAt: this.pickValue(
        patch.whisparrLastSyncedAt,
        existing?.whisparrLastSyncedAt ?? null,
      ),
      stashLastSyncedAt: this.pickValue(
        patch.stashLastSyncedAt,
        existing?.stashLastSyncedAt ?? null,
      ),
      lastSyncedAt: this.pickValue(
        patch.lastSyncedAt,
        existing?.lastSyncedAt ?? null,
      ),
      computedLifecycle: SceneLifecycle.NOT_REQUESTED,
      lifecycleSortOrder: 999,
    };

    const computedLifecycle = this.computeLifecycle(merged, queueItems);
    merged.computedLifecycle = computedLifecycle;
    merged.lifecycleSortOrder = this.lifecycleSortOrder(computedLifecycle);

    return merged;
  }

  private computeLifecycle(
    row: Pick<
      SceneIndexPatch,
      | 'stashId'
      | 'requestStatus'
      | 'whisparrMovieId'
      | 'whisparrHasFile'
      | 'whisparrQueueStatus'
      | 'whisparrQueueState'
      | 'whisparrErrorMessage'
      | 'stashAvailable'
    >,
    queueItems?: ResolverQueueItem[],
  ): SceneLifecycle {
    const movie =
      row.whisparrMovieId !== null && row.whisparrMovieId !== undefined
        ? {
            movieId: row.whisparrMovieId,
            stashId: row.stashId,
            hasFile: row.whisparrHasFile === true,
          }
        : null;

    const resolved = resolveSceneStatus({
      stashId: row.stashId,
      movie,
      queueItems: queueItems ?? this.synthesizeQueueItems(row),
      stashAvailable: row.stashAvailable === true,
      fallbackRequestStatus: row.requestStatus ?? null,
    });

    return resolved.state as SceneLifecycle;
  }

  private synthesizeQueueItems(
    row: Pick<
      SceneIndexPatch,
      | 'whisparrMovieId'
      | 'whisparrQueueStatus'
      | 'whisparrQueueState'
      | 'whisparrErrorMessage'
    >,
  ): ResolverQueueItem[] {
    if (
      row.whisparrMovieId === null ||
      row.whisparrMovieId === undefined ||
      !row.whisparrQueueStatus
    ) {
      return [];
    }

    return [
      {
        movieId: row.whisparrMovieId,
        status: row.whisparrQueueStatus,
        trackedDownloadState: row.whisparrQueueState ?? null,
        trackedDownloadStatus: null,
        errorMessage: row.whisparrErrorMessage ?? null,
      },
    ];
  }

  private lifecycleSortOrder(lifecycle: SceneLifecycle): number {
    switch (lifecycle) {
      case SceneLifecycle.FAILED:
        return 0;
      case SceneLifecycle.DOWNLOADING:
        return 1;
      case SceneLifecycle.IMPORT_PENDING:
        return 2;
      case SceneLifecycle.REQUESTED:
        return 3;
      case SceneLifecycle.AVAILABLE:
        return 90;
      case SceneLifecycle.NOT_REQUESTED:
      default:
        return 100;
    }
  }

  private mergePatchesByStashId(patches: SceneIndexPatch[]): SceneIndexPatch[] {
    const merged = new Map<string, SceneIndexPatch>();

    for (const patch of patches) {
      const stashId = patch.stashId.trim();
      if (!stashId) {
        continue;
      }

      merged.set(stashId, {
        ...(merged.get(stashId) ?? { stashId }),
        ...patch,
        stashId,
      });
    }

    return Array.from(merged.values());
  }

  private buildSceneIndexSummaryDelta(
    chunk: SceneIndexPatch[],
    nextRows: SceneIndexUpsertData[],
    existingByStashId: Map<string, SceneIndex>,
  ): SceneIndexSummaryDelta {
    const delta: SceneIndexSummaryDelta = {
      indexedScenes: 0,
      acquisitionTrackedScenes: 0,
      requestedCount: 0,
      downloadingCount: 0,
      importPendingCount: 0,
      failedCount: 0,
      metadataPendingCount: 0,
      metadataRetryableCount: 0,
      lastIndexWriteAt: chunk.length > 0 ? new Date() : null,
    };

    nextRows.forEach((nextRow, index) => {
      const patch = chunk[index];
      const existing = existingByStashId.get(patch?.stashId ?? '') ?? null;

      if (!existing) {
        delta.indexedScenes += 1;
      }

      delta.acquisitionTrackedScenes +=
        (this.isAcquisitionLifecycle(nextRow.computedLifecycle) ? 1 : 0) -
        (this.isAcquisitionLifecycle(existing?.computedLifecycle ?? null)
          ? 1
          : 0);

      delta.requestedCount += this.lifecycleCountDelta(
        nextRow.computedLifecycle,
        existing?.computedLifecycle ?? null,
        SceneLifecycle.REQUESTED,
      );
      delta.downloadingCount += this.lifecycleCountDelta(
        nextRow.computedLifecycle,
        existing?.computedLifecycle ?? null,
        SceneLifecycle.DOWNLOADING,
      );
      delta.importPendingCount += this.lifecycleCountDelta(
        nextRow.computedLifecycle,
        existing?.computedLifecycle ?? null,
        SceneLifecycle.IMPORT_PENDING,
      );
      delta.failedCount += this.lifecycleCountDelta(
        nextRow.computedLifecycle,
        existing?.computedLifecycle ?? null,
        SceneLifecycle.FAILED,
      );

      delta.metadataPendingCount += this.metadataStateCountDelta(
        nextRow.metadataHydrationState,
        existing?.metadataHydrationState ?? null,
        MetadataHydrationState.PENDING,
      );
      delta.metadataRetryableCount += this.metadataStateCountDelta(
        nextRow.metadataHydrationState,
        existing?.metadataHydrationState ?? null,
        MetadataHydrationState.FAILED_RETRYABLE,
      );
    });

    return delta;
  }

  private buildSceneIndexSummaryDeltaUpdate(
    delta: SceneIndexSummaryDelta,
  ): Prisma.SceneIndexSummaryUpdateInput {
    return {
      indexedScenes: {
        increment: delta.indexedScenes,
      },
      acquisitionTrackedScenes: {
        increment: delta.acquisitionTrackedScenes,
      },
      requestedCount: {
        increment: delta.requestedCount,
      },
      downloadingCount: {
        increment: delta.downloadingCount,
      },
      importPendingCount: {
        increment: delta.importPendingCount,
      },
      failedCount: {
        increment: delta.failedCount,
      },
      metadataPendingCount: {
        increment: delta.metadataPendingCount,
      },
      metadataRetryableCount: {
        increment: delta.metadataRetryableCount,
      },
      lastIndexWriteAt: delta.lastIndexWriteAt,
    };
  }

  private hasSummaryDelta(delta: SceneIndexSummaryDelta): boolean {
    return (
      delta.indexedScenes !== 0 ||
      delta.acquisitionTrackedScenes !== 0 ||
      delta.requestedCount !== 0 ||
      delta.downloadingCount !== 0 ||
      delta.importPendingCount !== 0 ||
      delta.failedCount !== 0 ||
      delta.metadataPendingCount !== 0 ||
      delta.metadataRetryableCount !== 0 ||
      delta.lastIndexWriteAt !== null
    );
  }

  private lifecycleCountDelta(
    nextLifecycle: SceneLifecycle,
    previousLifecycle: SceneLifecycle | null,
    targetLifecycle: SceneLifecycle,
  ): number {
    return (
      (nextLifecycle === targetLifecycle ? 1 : 0) -
      (previousLifecycle === targetLifecycle ? 1 : 0)
    );
  }

  private metadataStateCountDelta(
    nextState: MetadataHydrationState,
    previousState: MetadataHydrationState | null,
    targetState: MetadataHydrationState,
  ): number {
    return (
      (nextState === targetState ? 1 : 0) -
      (previousState === targetState ? 1 : 0)
    );
  }

  private isAcquisitionLifecycle(
    lifecycle: SceneLifecycle | null,
  ): lifecycle is SceneLifecycle {
    return lifecycle !== null && ACQUISITION_LIFECYCLES.includes(lifecycle);
  }

  private async ensureSceneIndexSummary(): Promise<void> {
    const existingSummary = await this.prisma.sceneIndexSummary.findUnique({
      where: {
        key: SCENE_INDEX_SUMMARY_KEY,
      },
      select: {
        key: true,
      },
    });

    if (existingSummary) {
      return;
    }

    await this.rebuildSceneIndexSummary();
  }

  private async rebuildSceneIndexSummary(): Promise<void> {
    const [
      indexedScenes,
      requestedCount,
      downloadingCount,
      importPendingCount,
      failedCount,
      metadataPendingCount,
      metadataRetryableCount,
      newestRow,
    ] = await this.prisma.$transaction([
      this.prisma.sceneIndex.count(),
      this.prisma.sceneIndex.count({
        where: {
          computedLifecycle: SceneLifecycle.REQUESTED,
        },
      }),
      this.prisma.sceneIndex.count({
        where: {
          computedLifecycle: SceneLifecycle.DOWNLOADING,
        },
      }),
      this.prisma.sceneIndex.count({
        where: {
          computedLifecycle: SceneLifecycle.IMPORT_PENDING,
        },
      }),
      this.prisma.sceneIndex.count({
        where: {
          computedLifecycle: SceneLifecycle.FAILED,
        },
      }),
      this.prisma.sceneIndex.count({
        where: {
          metadataHydrationState: MetadataHydrationState.PENDING,
        },
      }),
      this.prisma.sceneIndex.count({
        where: {
          metadataHydrationState: MetadataHydrationState.FAILED_RETRYABLE,
        },
      }),
      this.prisma.sceneIndex.findFirst({
        select: {
          lastSyncedAt: true,
          updatedAt: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      }),
    ]);

    await this.prisma.sceneIndexSummary.upsert({
      where: {
        key: SCENE_INDEX_SUMMARY_KEY,
      },
      create: {
        key: SCENE_INDEX_SUMMARY_KEY,
        indexedScenes,
        acquisitionTrackedScenes:
          requestedCount + downloadingCount + importPendingCount + failedCount,
        requestedCount,
        downloadingCount,
        importPendingCount,
        failedCount,
        metadataPendingCount,
        metadataRetryableCount,
        lastIndexWriteAt:
          newestRow?.lastSyncedAt ?? newestRow?.updatedAt ?? null,
      },
      update: {
        indexedScenes,
        acquisitionTrackedScenes:
          requestedCount + downloadingCount + importPendingCount + failedCount,
        requestedCount,
        downloadingCount,
        importPendingCount,
        failedCount,
        metadataPendingCount,
        metadataRetryableCount,
        lastIndexWriteAt:
          newestRow?.lastSyncedAt ?? newestRow?.updatedAt ?? null,
      },
    });
  }

  private async lookupWhisparrMoviesById(
    movieIds: number[],
    config: WhisparrAdapterBaseConfig,
  ): Promise<Map<number, WhisparrMovieLookupResult>> {
    const foundMovies = new Map<number, WhisparrMovieLookupResult>();

    for (
      let i = 0;
      i < movieIds.length;
      i += IndexingService.WHISPARR_LOOKUP_BATCH_SIZE
    ) {
      const batch = movieIds.slice(
        i,
        i + IndexingService.WHISPARR_LOOKUP_BATCH_SIZE,
      );
      const results = await Promise.all(
        batch.map(async (movieId) => {
          try {
            const movie = await this.whisparrAdapter.findMovieById(
              movieId,
              config,
            );
            return movie;
          } catch (error) {
            this.logger.warn(
              `Failed Whisparr movie-by-id lookup for movieId=${movieId}. error=${this.safeJson(
                this.serializeError(error),
              )}`,
            );
            return null;
          }
        }),
      );

      for (const movie of results) {
        if (!movie) {
          continue;
        }

        foundMovies.set(movie.movieId, movie);
      }
    }

    return foundMovies;
  }

  private groupQueueItemsByMovieId(
    queueItems: WhisparrQueueSnapshotItem[],
  ): Map<number, ResolverQueueItem[]> {
    const grouped = new Map<number, ResolverQueueItem[]>();

    for (const item of queueItems) {
      const existing = grouped.get(item.movieId) ?? [];
      existing.push(item);
      grouped.set(item.movieId, existing);
    }

    return grouped;
  }

  private summarizeQueueItems(items: ResolverQueueItem[]): {
    status: string | null;
    state: string | null;
    errorMessage: string | null;
  } {
    if (items.length === 0) {
      return {
        status: null,
        state: null,
        errorMessage: null,
      };
    }

    const ranked = [...items].sort(
      (left, right) => this.rankQueueItem(left) - this.rankQueueItem(right),
    );
    const selected = ranked[0] ?? null;

    if (!selected) {
      return {
        status: null,
        state: null,
        errorMessage: null,
      };
    }

    return {
      status: selected.status,
      state: selected.trackedDownloadState,
      errorMessage: selected.errorMessage,
    };
  }

  private rankQueueItem(item: ResolverQueueItem): number {
    const normalizedStatus = item.status?.trim().toLowerCase() ?? '';
    const normalizedState =
      item.trackedDownloadState?.trim().toLowerCase() ?? '';

    if (
      normalizedStatus === 'failed' ||
      normalizedStatus === 'warning' ||
      normalizedStatus === 'paused'
    ) {
      return 0;
    }

    if (
      normalizedStatus === 'completed' ||
      normalizedState === 'importpending' ||
      normalizedState === 'importing'
    ) {
      return 1;
    }

    if (normalizedStatus === 'downloading') {
      return 2;
    }

    if (normalizedStatus === 'queued') {
      return 3;
    }

    return 4;
  }

  private async collectLocalStashIdentitySnapshot(config: {
    baseUrl: string;
    apiKey: string | null;
  }): Promise<{
    localSceneCount: number;
    availableStashIds: Set<string>;
  }> {
    const availableStashIds = new Set<string>();
    let page = 1;
    let localSceneCount = 0;

    while (true) {
      const snapshotPage = await this.stashAdapter.getLocalSceneIdentityPage(
        config,
        {
          page,
          perPage: IndexingService.STASH_IDENTITY_PAGE_SIZE,
        },
      );

      localSceneCount += snapshotPage.items.length;
      for (const item of snapshotPage.items) {
        for (const linkedStashId of item.linkedStashIds) {
          availableStashIds.add(linkedStashId.stashId);
        }
      }

      if (!snapshotPage.hasMore || snapshotPage.items.length === 0) {
        break;
      }

      page += 1;
    }

    return {
      localSceneCount,
      availableStashIds,
    };
  }

  private isSuccessfulSyncFresh(
    state: {
      status: SyncJobStatus;
      lastSuccessAt: Date | null;
    } | null,
    maxAgeMs: number,
  ): boolean {
    if (
      !state ||
      state.status !== SyncJobStatus.SUCCEEDED ||
      !state.lastSuccessAt
    ) {
      return false;
    }

    return Date.now() - state.lastSuccessAt.getTime() <= maxAgeMs;
  }

  private async getMetadataBackfillTargets(
    cursor: string | null,
    forceBootstrapPass: boolean,
  ): Promise<Array<{ stashId: string }>> {
    const where = this.buildMetadataBackfillWhere(forceBootstrapPass);

    const directQuery = await this.prisma.sceneIndex.findMany({
      where: cursor
        ? {
            AND: [
              where,
              {
                stashId: {
                  gt: cursor,
                },
              },
            ],
          }
        : where,
      select: {
        stashId: true,
      },
      orderBy: {
        stashId: 'asc',
      },
      take: IndexingService.METADATA_BATCH_SIZE,
    });

    if (directQuery.length > 0 || !cursor) {
      return directQuery;
    }

    return this.prisma.sceneIndex.findMany({
      where,
      select: {
        stashId: true,
      },
      orderBy: {
        stashId: 'asc',
      },
      take: IndexingService.METADATA_BATCH_SIZE,
    });
  }

  private async shouldRunScheduledMetadataBackfill(): Promise<boolean> {
    const [
      pendingMetadataCount,
      retryableMetadataCount,
      staleMetadataCount,
      syncState,
    ] = await Promise.all([
      this.prisma.sceneIndex.count({
        where: {
          metadataHydrationState: MetadataHydrationState.PENDING,
        },
      }),
      this.prisma.sceneIndex.count({
        where: this.buildMissingMetadataBacklogWhere(),
      }),
      this.prisma.sceneIndex.count({
        where: this.buildStaleHydratedMetadataWhere(),
      }),
      this.prisma.syncState.findUnique({
        where: {
          jobName: INDEXING_JOB_NAMES.METADATA_BACKFILL,
        },
        select: {
          lastSuccessAt: true,
        },
      }),
    ]);

    const targetIntervalMs =
      pendingMetadataCount > 0
        ? IndexingService.METADATA_ACCELERATED_INTERVAL_MS
        : retryableMetadataCount > 0
          ? IndexingService.METADATA_RETRY_BACKOFF_MS
          : staleMetadataCount > 0
            ? IndexingService.METADATA_STEADY_INTERVAL_MS
            : IndexingService.METADATA_STEADY_INTERVAL_MS;
    const lastSuccessAt = syncState?.lastSuccessAt ?? null;

    if (!lastSuccessAt) {
      return true;
    }

    return Date.now() - lastSuccessAt.getTime() >= targetIntervalMs;
  }

  private buildMissingMetadataBacklogWhere(): Prisma.SceneIndexWhereInput {
    return {
      metadataHydrationState: MetadataHydrationState.FAILED_RETRYABLE,
    };
  }

  private buildMetadataBackfillWhere(
    forceBootstrapPass: boolean,
  ): Prisma.SceneIndexWhereInput {
    if (forceBootstrapPass) {
      return {
        metadataHydrationState: {
          in: [
            MetadataHydrationState.PENDING,
            MetadataHydrationState.FAILED_RETRYABLE,
          ],
        },
      };
    }

    return {
      OR: [
        {
          metadataHydrationState: MetadataHydrationState.PENDING,
        },
        this.buildRetryableMetadataWhere(),
        this.buildStaleHydratedMetadataWhere(),
      ],
    };
  }

  private buildRetryableMetadataWhere(): Prisma.SceneIndexWhereInput {
    return {
      metadataHydrationState: MetadataHydrationState.FAILED_RETRYABLE,
      OR: [
        {
          metadataRetryAfterAt: null,
        },
        {
          metadataRetryAfterAt: {
            lte: new Date(),
          },
        },
      ],
    };
  }

  private buildStaleHydratedMetadataWhere(): Prisma.SceneIndexWhereInput {
    return {
      metadataHydrationState: MetadataHydrationState.HYDRATED,
      metadataLastSyncedAt: {
        lte: new Date(Date.now() - IndexingService.METADATA_REFRESH_MAX_AGE_MS),
      },
    };
  }

  private buildMetadataPatchFromScene(
    scene: StashdbSceneMetadata,
    now: Date,
  ): SceneIndexPatch {
    return {
      stashId: scene.id,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      studioId: scene.studioId,
      studioName: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      metadataHydrationState: MetadataHydrationState.HYDRATED,
      metadataLastSyncedAt: now,
      metadataRetryAfterAt: null,
      lastSyncedAt: now,
    };
  }

  private shouldHydrateMetadataNow(row: SceneIndex | null): boolean {
    if (!row) {
      return true;
    }

    if (row.metadataHydrationState === MetadataHydrationState.PENDING) {
      return true;
    }

    if (
      row.metadataHydrationState !== MetadataHydrationState.FAILED_RETRYABLE
    ) {
      return false;
    }

    if (!row.metadataRetryAfterAt) {
      return true;
    }

    return row.metadataRetryAfterAt.getTime() <= Date.now();
  }

  private pickValue<T>(incoming: T | undefined, existing: T): T {
    return incoming === undefined ? existing : incoming;
  }

  private isDeadlockError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.toLowerCase().includes('deadlock detected');
    }

    return false;
  }

  private normalizeStashIds(stashIds: string[]): string[] {
    return Array.from(
      new Set(
        stashIds
          .map((stashId) => stashId.trim())
          .filter((stashId) => stashId.length > 0),
      ),
    );
  }

  private async isIntegrationConfigured(
    type: IntegrationType,
  ): Promise<boolean> {
    try {
      const integration = await this.integrationsService.findOne(type);
      return (
        integration.enabled &&
        integration.status === IntegrationStatus.CONFIGURED &&
        Boolean(integration.baseUrl?.trim())
      );
    } catch {
      return false;
    }
  }

  private async getWhisparrConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  } | null> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.WHISPARR,
      );
      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      return {
        baseUrl,
        apiKey: integration.apiKey,
      };
    } catch {
      return null;
    }
  }

  private async getStashConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  } | null> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.STASH,
      );
      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      return {
        baseUrl,
        apiKey: integration.apiKey,
      };
    } catch {
      return null;
    }
  }

  private async getStashdbConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  } | null> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.STASHDB,
      );
      if (
        !integration.enabled ||
        integration.status !== IntegrationStatus.CONFIGURED
      ) {
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        return null;
      }

      return {
        baseUrl,
        apiKey: integration.apiKey,
      };
    } catch {
      return null;
    }
  }

  private safeJson(value: unknown): string {
    try {
      const serialized = JSON.stringify(value, null, 2);
      if (!serialized) {
        return 'null';
      }

      return serialized.length > 4000
        ? `${serialized.slice(0, 4000)}...(truncated)`
        : serialized;
    } catch {
      return '[unserializable]';
    }
  }

  private serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return {
      type: typeof error,
      value: error,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async withSceneIndexWriteBarrier<T>(
    task: () => Promise<T>,
  ): Promise<T> {
    const previousBarrier = this.sceneIndexWriteBarrier;
    let releaseBarrier!: () => void;

    this.sceneIndexWriteBarrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    await previousBarrier;

    try {
      return await task();
    } finally {
      releaseBarrier();
    }
  }
}
