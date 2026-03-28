import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  RequestStatus,
} from '@prisma/client';
import { IndexingService } from '../indexing/indexing.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import {
  WhisparrAdapter,
  WhisparrMovieLookupResult,
} from '../providers/whisparr/whisparr.adapter';
import { SceneStatusDto } from './dto/scene-status.dto';
import {
  resolveSceneStatus,
  WhisparrQueueSnapshotItem,
} from './scene-status.resolver';

@Injectable()
export class SceneStatusService {
  private static readonly NOT_REQUESTED: SceneStatusDto = {
    state: 'NOT_REQUESTED',
  };
  private static readonly STASH_BATCH_SIZE = 6;
  private static readonly STASH_AVAILABILITY_CACHE_TTL_MS = 15_000;
  private static readonly STASH_AVAILABILITY_CACHE_MAX_ENTRIES = 4000;
  private static readonly WHISPARR_BATCH_SIZE = 8;

  private readonly logger = new Logger(SceneStatusService.name);
  private readonly stashAvailabilityCache = new Map<
    string,
    { available: boolean; expiresAt: number }
  >();
  private readonly stashAvailabilityLookups = new Map<
    string,
    Promise<boolean>
  >();

  constructor(
    private readonly indexingService: IndexingService,
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
    private readonly stashAdapter: StashAdapter,
    private readonly whisparrAdapter: WhisparrAdapter,
  ) {}

  async resolveForScene(stashId: string): Promise<SceneStatusDto> {
    const normalized = stashId.trim();
    if (!normalized) {
      this.logger.debug('resolveForScene received empty stashId.');
      return SceneStatusService.NOT_REQUESTED;
    }

    const indexedRows = await this.indexingService.getFreshSceneIndexRows([
      normalized,
    ]);
    const indexedRow = indexedRows.get(normalized);
    if (indexedRow) {
      return this.indexingService.toSceneStatus(indexedRow);
    }

    const [fallbackRequestStatus, stashConfig, whisparrConfig] =
      await Promise.all([
        this.resolveFallbackStatusForScene(normalized),
        this.getStashConfig(),
        this.getWhisparrConfig(),
      ]);
    const stashAvailability = await this.resolveStashAvailabilityForScenes(
      [normalized],
      stashConfig,
    );
    const stashAvailable = stashAvailability.get(normalized) === true;
    this.logger.debug(
      `resolveForScene fallback status: ${this.safeJson({
        stashId: normalized,
        fallbackRequestStatus,
        stashAvailable,
      })}`,
    );

    if (stashAvailable) {
      return { state: 'AVAILABLE' };
    }

    if (!whisparrConfig) {
      this.logger.debug(
        `Whisparr config unavailable; using fallback for stashId=${normalized}.`,
      );
      return resolveSceneStatus({
        stashId: normalized,
        movie: null,
        queueItems: [],
        stashAvailable,
        fallbackRequestStatus,
      });
    }

    try {
      const [movie, queueItems] = await Promise.all([
        this.whisparrAdapter.findMovieByStashId(normalized, whisparrConfig),
        this.whisparrAdapter.getQueueSnapshot(whisparrConfig),
      ]);

      const resolved = resolveSceneStatus({
        stashId: normalized,
        movie,
        queueItems,
        stashAvailable,
        fallbackRequestStatus,
      });

      this.logger.debug(
        `resolveForScene Whisparr-derived result: ${this.safeJson({
          stashId: normalized,
          movie,
          queueCount: queueItems.length,
          queueSample: queueItems.slice(0, 5),
          resolved,
        })}`,
      );

      return resolved;
    } catch (error) {
      this.logger.error(
        `resolveForScene Whisparr resolution failed; using fallback for stashId=${normalized}. error=${this.safeJson(
          this.serializeError(error),
        )}`,
      );
      return resolveSceneStatus({
        stashId: normalized,
        movie: null,
        queueItems: [],
        stashAvailable,
        fallbackRequestStatus,
      });
    }
  }

  async resolveForScenes(
    stashIds: string[],
  ): Promise<Map<string, SceneStatusDto>> {
    return this.resolveForScenesInternal(stashIds);
  }

  async resolveForScenesWithEvidence(
    stashIds: string[],
    evidence: {
      queueItems?: WhisparrQueueSnapshotItem[];
      movieByStashId?: Map<string, WhisparrMovieLookupResult>;
    },
  ): Promise<Map<string, SceneStatusDto>> {
    return this.resolveForScenesInternal(stashIds, evidence);
  }

  private async resolveForScenesInternal(
    stashIds: string[],
    evidence?: {
      queueItems?: WhisparrQueueSnapshotItem[];
      movieByStashId?: Map<string, WhisparrMovieLookupResult>;
    },
  ): Promise<Map<string, SceneStatusDto>> {
    const normalizedIds = Array.from(
      new Set(
        stashIds
          .map((stashId) => stashId.trim())
          .filter((stashId) => stashId.length > 0),
      ),
    );

    if (normalizedIds.length === 0) {
      this.logger.debug('resolveForScenes received no valid stashIds.');
      return new Map();
    }

    const indexedRows = await this.indexingService.getFreshSceneIndexRows(
      normalizedIds,
    );
    if (indexedRows.size === normalizedIds.length) {
      return this.mergeResolvedStatuses(normalizedIds, indexedRows, new Map());
    }

    const unresolvedIds = normalizedIds.filter(
      (stashId) => !indexedRows.has(stashId),
    );
    const [fallbackStatuses, stashConfig, whisparrConfig] = await Promise.all([
      this.resolveFallbackStatusesForScenes(unresolvedIds),
      this.getStashConfig(),
      this.getWhisparrConfig(),
    ]);
    const stashAvailability = await this.resolveStashAvailabilityForScenes(
      unresolvedIds,
      stashConfig,
    );
    const resolvedStatuses = this.resolveFallbackSceneStatuses(
      unresolvedIds,
      fallbackStatuses,
      stashAvailability,
    );
    this.logger.debug(
      `resolveForScenes fallback map prepared: ${this.safeJson({
        inputCount: stashIds.length,
        normalizedCount: normalizedIds.length,
        unresolvedIds,
        fallbackStatuses: Array.from(fallbackStatuses.entries()),
        stashAvailability: Array.from(stashAvailability.entries()),
        indexedRows: Array.from(indexedRows.keys()),
      })}`,
    );

    if (!whisparrConfig) {
      this.logger.debug(
        'Whisparr config unavailable for batch resolution; returning fallback map.',
      );
      return this.mergeResolvedStatuses(
        normalizedIds,
        indexedRows,
        resolvedStatuses,
      );
    }

    const unresolvedRemoteIds = unresolvedIds.filter(
      (stashId) => stashAvailability.get(stashId) !== true,
    );
    if (unresolvedRemoteIds.length === 0) {
      return this.mergeResolvedStatuses(
        normalizedIds,
        indexedRows,
        resolvedStatuses,
      );
    }

    let queueItems = evidence?.queueItems;
    if (!queueItems) {
      try {
        queueItems =
          await this.whisparrAdapter.getQueueSnapshot(whisparrConfig);
        this.logger.debug(
          `resolveForScenes queue snapshot loaded once: ${this.safeJson({
            queueCount: queueItems.length,
            queueSample: queueItems.slice(0, 5),
          })}`,
        );
      } catch (error) {
        this.logger.error(
          `resolveForScenes failed to fetch Whisparr queue snapshot; returning fallback map. error=${this.safeJson(
            this.serializeError(error),
          )}`,
        );
        return this.mergeResolvedStatuses(
          normalizedIds,
          indexedRows,
          resolvedStatuses,
        );
      }
    }

    const movieByStashId =
      evidence?.movieByStashId ??
      (await this.lookupWhisparrMoviesForScenes(
        unresolvedRemoteIds,
        whisparrConfig,
      ));
    const resolvedQueueItems = queueItems ?? [];

    for (const stashId of unresolvedRemoteIds) {
      resolvedStatuses.set(
        stashId,
        resolveSceneStatus({
          stashId,
          movie: movieByStashId.get(stashId) ?? null,
          queueItems: resolvedQueueItems,
          stashAvailable: false,
          fallbackRequestStatus: fallbackStatuses.get(stashId) ?? null,
        }),
      );
    }

    this.logger.debug(
      `resolveForScenes final resolved map: ${this.safeJson(
        Array.from(resolvedStatuses.entries()),
      )}`,
    );

    return this.mergeResolvedStatuses(normalizedIds, indexedRows, resolvedStatuses);
  }

  private mergeResolvedStatuses(
    orderedIds: string[],
    indexedRows: Map<string, { computedLifecycle: SceneStatusDto['state'] }>,
    resolvedStatuses: Map<string, SceneStatusDto>,
  ): Map<string, SceneStatusDto> {
    const merged = new Map<string, SceneStatusDto>();

    for (const stashId of orderedIds) {
      const indexedRow = indexedRows.get(stashId);
      if (indexedRow) {
        merged.set(stashId, this.indexingService.toSceneStatus(indexedRow));
        continue;
      }

      const resolved = resolvedStatuses.get(stashId);
      if (resolved) {
        merged.set(stashId, resolved);
      }
    }

    return merged;
  }

  private async lookupWhisparrMoviesForScenes(
    stashIds: string[],
    whisparrConfig: { baseUrl: string; apiKey: string | null },
  ): Promise<Map<string, WhisparrMovieLookupResult>> {
    const movieByStashId = new Map<string, WhisparrMovieLookupResult>();

    for (
      let i = 0;
      i < stashIds.length;
      i += SceneStatusService.WHISPARR_BATCH_SIZE
    ) {
      const batch = stashIds.slice(
        i,
        i + SceneStatusService.WHISPARR_BATCH_SIZE,
      );

      const batchLookups = await Promise.all(
        batch.map(async (stashIdInBatch) => {
          try {
            const movie = await this.whisparrAdapter.findMovieByStashId(
              stashIdInBatch,
              whisparrConfig,
            );
            return {
              stashId: stashIdInBatch,
              movie,
              failed: false,
            };
          } catch (error) {
            this.logger.error(
              `resolveForScenes movie lookup failed for stashId=${stashIdInBatch}. error=${this.safeJson(
                this.serializeError(error),
              )}`,
            );
            return {
              stashId: stashIdInBatch,
              movie: null,
              failed: true,
            };
          }
        }),
      );

      this.logger.debug(
        `resolveForScenes batch lookup results: ${this.safeJson({
          batch,
          batchLookups,
        })}`,
      );

      for (const result of batchLookups) {
        if (result.failed || !result.movie) {
          continue;
        }

        movieByStashId.set(result.stashId, result.movie);
      }
    }

    return movieByStashId;
  }

  private async resolveFallbackStatusForScene(
    stashId: string,
  ): Promise<RequestStatus | null> {
    const request = await this.prisma.request.findUnique({
      where: { stashId },
      select: { status: true },
    });

    if (!request) {
      this.logger.debug(
        `No fallback Request row found for stashId=${stashId}; returning NOT_REQUESTED.`,
      );
      return null;
    }

    this.logger.debug(
      `Fallback Request mapping for scene: ${this.safeJson({
        stashId,
        fallbackRequestStatus: request.status,
      })}`,
    );

    return request.status;
  }

  private async resolveFallbackStatusesForScenes(
    normalizedIds: string[],
  ): Promise<Map<string, RequestStatus | null>> {
    const requests = await this.prisma.request.findMany({
      where: {
        stashId: {
          in: normalizedIds,
        },
      },
      select: {
        stashId: true,
        status: true,
      },
    });

    const statusById = new Map<string, RequestStatus | null>();

    for (const request of requests) {
      statusById.set(request.stashId, request.status);
    }

    for (const stashId of normalizedIds) {
      if (!statusById.has(stashId)) {
        statusById.set(stashId, null);
      }
    }

    this.logger.debug(
      `Fallback Request mapping for batch: ${this.safeJson({
        inputCount: normalizedIds.length,
        foundRequestRows: requests.length,
        statuses: Array.from(statusById.entries()),
      })}`,
    );

    return statusById;
  }

  private resolveFallbackSceneStatuses(
    normalizedIds: string[],
    fallbackStatuses: Map<string, RequestStatus | null>,
    stashAvailability: Map<string, boolean>,
  ): Map<string, SceneStatusDto> {
    const statusById = new Map<string, SceneStatusDto>();

    for (const stashId of normalizedIds) {
      statusById.set(
        stashId,
        resolveSceneStatus({
          stashId,
          movie: null,
          queueItems: [],
          stashAvailable: stashAvailability.get(stashId) === true,
          fallbackRequestStatus: fallbackStatuses.get(stashId) ?? null,
        }),
      );
    }

    return statusById;
  }

  private async resolveStashAvailabilityForScenes(
    normalizedIds: string[],
    stashConfig: { baseUrl: string; apiKey: string | null } | null,
  ): Promise<Map<string, boolean>> {
    if (!stashConfig) {
      return new Map();
    }

    const stashAvailability = new Map<string, boolean>();
    this.pruneStashAvailabilityCache();

    for (
      let i = 0;
      i < normalizedIds.length;
      i += SceneStatusService.STASH_BATCH_SIZE
    ) {
      const batch = normalizedIds.slice(
        i,
        i + SceneStatusService.STASH_BATCH_SIZE,
      );
      const results = await Promise.all(
        batch.map(async (stashId) => {
          try {
            const available = await this.lookupStashAvailability(
              stashId,
              stashConfig,
            );
            return {
              stashId,
              available,
              failed: false,
            };
          } catch (error) {
            this.logger.error(
              `resolveForScenes stash lookup failed for stashId=${stashId}. error=${this.safeJson(
                this.serializeError(error),
              )}`,
            );
            return {
              stashId,
              available: false,
              failed: true,
            };
          }
        }),
      );

      for (const result of results) {
        if (result.failed) {
          continue;
        }

        stashAvailability.set(result.stashId, result.available);
      }
    }

    return stashAvailability;
  }

  private async lookupStashAvailability(
    stashId: string,
    stashConfig: { baseUrl: string; apiKey: string | null },
  ): Promise<boolean> {
    const cacheKey = this.buildStashAvailabilityCacheKey(stashId, stashConfig);
    const cached = this.readStashAvailabilityCache(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const inFlight = this.stashAvailabilityLookups.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const lookup = this.stashAdapter
      .findScenesByStashId(stashId, stashConfig)
      .then((copies) => {
        const available = copies.length > 0;
        this.writeStashAvailabilityCache(cacheKey, available);
        return available;
      })
      .finally(() => {
        this.stashAvailabilityLookups.delete(cacheKey);
      });

    this.stashAvailabilityLookups.set(cacheKey, lookup);
    return lookup;
  }

  private buildStashAvailabilityCacheKey(
    stashId: string,
    stashConfig: { baseUrl: string; apiKey: string | null },
  ): string {
    return `${stashConfig.baseUrl.trim()}|${stashConfig.apiKey?.trim() ?? ''}|${stashId}`;
  }

  private readStashAvailabilityCache(cacheKey: string): boolean | null {
    const cached = this.stashAvailabilityCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    if (cached.expiresAt <= Date.now()) {
      this.stashAvailabilityCache.delete(cacheKey);
      return null;
    }

    return cached.available;
  }

  private writeStashAvailabilityCache(
    cacheKey: string,
    available: boolean,
  ): void {
    this.stashAvailabilityCache.set(cacheKey, {
      available,
      expiresAt:
        Date.now() + SceneStatusService.STASH_AVAILABILITY_CACHE_TTL_MS,
    });
    this.pruneStashAvailabilityCache();
  }

  private pruneStashAvailabilityCache(now = Date.now()): void {
    for (const [cacheKey, entry] of this.stashAvailabilityCache.entries()) {
      if (entry.expiresAt <= now) {
        this.stashAvailabilityCache.delete(cacheKey);
      }
    }

    const overflow =
      this.stashAvailabilityCache.size -
      SceneStatusService.STASH_AVAILABILITY_CACHE_MAX_ENTRIES;
    if (overflow <= 0) {
      return;
    }

    let removed = 0;
    for (const cacheKey of this.stashAvailabilityCache.keys()) {
      this.stashAvailabilityCache.delete(cacheKey);
      removed += 1;
      if (removed >= overflow) {
        break;
      }
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

      if (!integration.enabled) {
        this.logger.debug('Whisparr integration found but disabled.');
        return null;
      }

      if (integration.status !== IntegrationStatus.CONFIGURED) {
        this.logger.debug(
          `Whisparr integration status is not CONFIGURED: ${integration.status}`,
        );
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        this.logger.debug('Whisparr integration has no baseUrl.');
        return null;
      }

      const config = {
        baseUrl,
        apiKey: integration.apiKey,
      };

      this.logger.debug(
        `Whisparr config resolved: ${this.safeJson({
          baseUrl: config.baseUrl,
          hasApiKey: Boolean(config.apiKey?.trim()),
        })}`,
      );

      return config;
    } catch (error) {
      this.logger.error(
        `Failed to resolve Whisparr integration config. error=${this.safeJson(
          this.serializeError(error),
        )}`,
      );
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

      if (!integration.enabled) {
        this.logger.debug('Stash integration found but disabled.');
        return null;
      }

      if (integration.status !== IntegrationStatus.CONFIGURED) {
        this.logger.debug(
          `Stash integration status is not CONFIGURED: ${integration.status}`,
        );
        return null;
      }

      const baseUrl = integration.baseUrl?.trim();
      if (!baseUrl) {
        this.logger.debug('Stash integration has no baseUrl.');
        return null;
      }

      return {
        baseUrl,
        apiKey: integration.apiKey,
      };
    } catch (error) {
      this.logger.error(
        `Failed to resolve Stash integration config. error=${this.safeJson(
          this.serializeError(error),
        )}`,
      );
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
}
