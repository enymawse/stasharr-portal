import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  Prisma,
  RequestStatus,
  SceneIndex,
  SceneLifecycle,
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
  metadataLastSyncedAt?: Date | null;
  whisparrLastSyncedAt?: Date | null;
  stashLastSyncedAt?: Date | null;
  lastSyncedAt?: Date | null;
}

interface SyncRunSummary {
  processedCount: number;
  updatedCount: number;
  cursor?: string | null;
}

@Injectable()
export class IndexingService {
  private static readonly INDEX_STATUS_MAX_AGE_MS = 30 * 60_000;
  private static readonly METADATA_REFRESH_MAX_AGE_MS =
    7 * 24 * 60 * 60_000;
  private static readonly APPLY_PATCH_CHUNK_SIZE = 100;
  private static readonly WHISPARR_LOOKUP_BATCH_SIZE = 8;
  private static readonly STASH_SYNC_BATCH_SIZE = 120;
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
      },
      async () => {
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
        onSuccessCursor: (result) => result.cursor,
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
        metadataLastSyncedAt: now,
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

    const results = await Promise.allSettled([
      this.syncWhisparrQueue(`${reason}:queue`),
      this.syncStashAvailability(`${reason}:stash`, normalizedIds),
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

  async getSyncStatus() {
    const [jobs, totalIndexedScenes, acquisitionTrackedScenes, missingMetadata] =
      await this.prisma.$transaction([
        this.prisma.syncState.findMany({
          orderBy: {
            jobName: 'asc',
          },
        }),
        this.prisma.sceneIndex.count(),
        this.prisma.sceneIndex.count({
          where: {
            computedLifecycle: {
              in: ACQUISITION_LIFECYCLES,
            },
          },
        }),
        this.prisma.sceneIndex.count({
          where: {
            OR: [
              { title: null },
              { imageUrl: null },
              { studioName: null },
              { metadataLastSyncedAt: null },
            ],
          },
        }),
      ]);

    return {
      totals: {
        indexedScenes: totalIndexedScenes,
        acquisitionTrackedScenes,
        missingMetadataScenes: missingMetadata,
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
      })),
    };
  }

  async getSceneIndexRows(stashIds: string[]): Promise<Map<string, SceneIndex>> {
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
      if (row.whisparrMovieId !== null && !existingByMovieId.has(row.whisparrMovieId)) {
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
          : null) ?? lookedUpMovies.get(movieId) ?? null;

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

    const candidateIds = stashIds?.length
      ? this.normalizeStashIds(stashIds)
      : await this.getStashSyncCandidateIds(forceFullPass);
    if (candidateIds.length === 0) {
      return {
        processedCount: 0,
        updatedCount: 0,
      };
    }

    const now = new Date();
    const patches: SceneIndexPatch[] = [];

    for (
      let i = 0;
      i < candidateIds.length;
      i += IndexingService.WHISPARR_LOOKUP_BATCH_SIZE
    ) {
      const batch = candidateIds.slice(
        i,
        i + IndexingService.WHISPARR_LOOKUP_BATCH_SIZE,
      );
      const batchResults = await Promise.all(
        batch.map(async (stashId) => {
          try {
            const matches = await this.stashAdapter.findScenesByStashId(
              stashId,
              config,
            );
            return {
              stashId,
              available: matches.length > 0,
            };
          } catch (error) {
            this.logger.warn(
              `Failed Stash availability lookup for stashId=${stashId}. error=${this.safeJson(
                this.serializeError(error),
              )}`,
            );
            return null;
          }
        }),
      );

      for (const result of batchResults) {
        if (!result) {
          continue;
        }

        patches.push({
          stashId: result.stashId,
          stashAvailable: result.available,
          stashLastSyncedAt: now,
          lastSyncedAt: now,
        });
      }
    }

    await this.applySceneIndexPatches(patches);
    this.logger.debug(
      `Stash availability sync completed: ${this.safeJson({
        reason,
        candidates: candidateIds.length,
        updated: patches.length,
      })}`,
    );

    return {
      processedCount: candidateIds.length,
      updatedCount: patches.length,
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
              metadataLastSyncedAt: now,
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

    if (requestRows.length === 0) {
      return [];
    }

    const now = new Date();
    await this.applySceneIndexPatches(
      requestRows.map((requestRow) => ({
        stashId: requestRow.stashId,
        requestStatus: requestRow.status,
        requestUpdatedAt: requestRow.updatedAt,
        lastSyncedAt: now,
      })),
    );

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
        await this.prisma.$transaction(
          chunk.map((patch) => {
            const data = this.buildSceneIndexUpsertData(
              existingByStashId.get(patch.stashId) ?? null,
              patch,
              queueItemsByStashId?.get(patch.stashId),
            );
            return this.prisma.sceneIndex.upsert({
              where: {
                stashId: patch.stashId,
              },
              create: data,
              update: data,
            });
          }),
        );
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
  ): Prisma.SceneIndexUncheckedCreateInput {
    const merged: Prisma.SceneIndexUncheckedCreateInput = {
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
      metadataLastSyncedAt: this.pickValue(
        patch.metadataLastSyncedAt,
        existing?.metadataLastSyncedAt ?? null,
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

  private async getStashSyncCandidateIds(
    forceFullPass: boolean,
  ): Promise<string[]> {
    if (forceFullPass) {
      const rows = await this.prisma.sceneIndex.findMany({
        select: {
          stashId: true,
        },
        orderBy: {
          requestUpdatedAt: 'desc',
        },
      });

      return rows.map((row) => row.stashId);
    }

    const availableRefreshCutoff = new Date(Date.now() - 60 * 60_000);
    const rows = await this.prisma.sceneIndex.findMany({
      where: {
        OR: [
          {
            computedLifecycle: {
              in: ACQUISITION_LIFECYCLES,
            },
          },
          {
            stashAvailable: true,
            stashLastSyncedAt: {
              lte: availableRefreshCutoff,
            },
          },
          {
            stashAvailable: true,
            stashLastSyncedAt: null,
          },
        ],
      },
      select: {
        stashId: true,
      },
      orderBy: [
        {
          lifecycleSortOrder: 'asc',
        },
        {
          stashLastSyncedAt: 'asc',
        },
        {
          stashId: 'asc',
        },
      ],
      take: IndexingService.STASH_SYNC_BATCH_SIZE,
    });

    return rows.map((row) => row.stashId);
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
    const [eligibleMetadataCount, missingMetadataCount, syncState] =
      await Promise.all([
        this.prisma.sceneIndex.count({
          where: this.buildMetadataBackfillWhere(false),
        }),
        this.prisma.sceneIndex.count({
          where: this.buildMissingMetadataBacklogWhere(),
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
      eligibleMetadataCount > 0
        ? IndexingService.METADATA_ACCELERATED_INTERVAL_MS
        : missingMetadataCount > 0
          ? IndexingService.METADATA_RETRY_BACKOFF_MS
          : IndexingService.METADATA_STEADY_INTERVAL_MS;
    const lastSuccessAt = syncState?.lastSuccessAt ?? null;

    if (!lastSuccessAt) {
      return true;
    }

    return Date.now() - lastSuccessAt.getTime() >= targetIntervalMs;
  }

  private buildMissingMetadataBacklogWhere(): Prisma.SceneIndexWhereInput {
    return {
      OR: [
        { title: null },
        { imageUrl: null },
        { studioName: null },
        { metadataLastSyncedAt: null },
      ],
    };
  }

  private buildMetadataBackfillWhere(
    forceBootstrapPass: boolean,
  ): Prisma.SceneIndexWhereInput {
    const missingMetadataWhere = this.buildMissingMetadataBacklogWhere();
    if (forceBootstrapPass) {
      return missingMetadataWhere;
    }

    const staleBefore = new Date(
      Date.now() - IndexingService.METADATA_REFRESH_MAX_AGE_MS,
    );
    const retryBefore = new Date(
      Date.now() - IndexingService.METADATA_RETRY_BACKOFF_MS,
    );

    return {
      OR: [
        {
          AND: [
            {
              OR: [
                { title: null },
                { imageUrl: null },
                { studioName: null },
              ],
            },
            {
              OR: [
                { metadataLastSyncedAt: null },
                {
                  metadataLastSyncedAt: {
                    lte: retryBefore,
                  },
                },
              ],
            },
          ],
        },
        {
          metadataLastSyncedAt: {
            lte: staleBefore,
          },
        },
      ],
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
      metadataLastSyncedAt: now,
      lastSyncedAt: now,
    };
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
