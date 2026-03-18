import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  RequestStatus,
} from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
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
  private static readonly WHISPARR_BATCH_SIZE = 8;

  private readonly logger = new Logger(SceneStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
    private readonly whisparrAdapter: WhisparrAdapter,
  ) {}

  async resolveForScene(stashId: string): Promise<SceneStatusDto> {
    const normalized = stashId.trim();
    if (!normalized) {
      this.logger.debug('resolveForScene received empty stashId.');
      return SceneStatusService.NOT_REQUESTED;
    }

    const fallback = await this.resolveFallbackStatusForScene(normalized);
    this.logger.debug(
      `resolveForScene fallback status: ${this.safeJson({
        stashId: normalized,
        fallback,
      })}`,
    );
    const whisparrConfig = await this.getWhisparrConfig();

    if (!whisparrConfig) {
      this.logger.debug(
        `Whisparr config unavailable; using fallback for stashId=${normalized}.`,
      );
      return fallback;
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
      return fallback;
    }
  }

  async resolveForScenes(
    stashIds: string[],
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

    const fallbackStatuses =
      await this.resolveFallbackStatusesForScenes(normalizedIds);
    this.logger.debug(
      `resolveForScenes fallback map prepared: ${this.safeJson({
        inputCount: stashIds.length,
        normalizedCount: normalizedIds.length,
        normalizedIds,
        fallbackStatuses: Array.from(fallbackStatuses.entries()),
      })}`,
    );
    const whisparrConfig = await this.getWhisparrConfig();

    if (!whisparrConfig) {
      this.logger.debug(
        'Whisparr config unavailable for batch resolution; returning fallback map.',
      );
      return fallbackStatuses;
    }

    let queueItems: WhisparrQueueSnapshotItem[];
    try {
      queueItems = await this.whisparrAdapter.getQueueSnapshot(whisparrConfig);
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
      return fallbackStatuses;
    }

    const resolvedStatuses = new Map<string, SceneStatusDto>(fallbackStatuses);

    for (
      let i = 0;
      i < normalizedIds.length;
      i += SceneStatusService.WHISPARR_BATCH_SIZE
    ) {
      const batch = normalizedIds.slice(
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
        if (result.failed) {
          continue;
        }

        resolvedStatuses.set(
          result.stashId,
          resolveSceneStatus({
            stashId: result.stashId,
            movie: result.movie,
            queueItems,
          }),
        );
      }
    }

    this.logger.debug(
      `resolveForScenes final resolved map: ${this.safeJson(
        Array.from(resolvedStatuses.entries()),
      )}`,
    );

    return resolvedStatuses;
  }

  private async resolveFallbackStatusForScene(
    stashId: string,
  ): Promise<SceneStatusDto> {
    const request = await this.prisma.request.findUnique({
      where: { stashId },
      select: { status: true },
    });

    if (!request) {
      this.logger.debug(
        `No fallback Request row found for stashId=${stashId}; returning NOT_REQUESTED.`,
      );
      return SceneStatusService.NOT_REQUESTED;
    }

    const mapped = {
      state: this.mapRequestStatus(request.status),
    };

    this.logger.debug(
      `Fallback Request mapping for scene: ${this.safeJson({
        stashId,
        requestStatus: request.status,
        mapped,
      })}`,
    );

    return mapped;
  }

  private async resolveFallbackStatusesForScenes(
    normalizedIds: string[],
  ): Promise<Map<string, SceneStatusDto>> {
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

    const statusById = new Map<string, SceneStatusDto>();

    for (const request of requests) {
      statusById.set(request.stashId, {
        state: this.mapRequestStatus(request.status),
      });
    }

    for (const stashId of normalizedIds) {
      if (!statusById.has(stashId)) {
        statusById.set(stashId, SceneStatusService.NOT_REQUESTED);
      }
    }

    this.logger.debug(
      `Fallback Request mapping for batch: ${this.safeJson({
        requestedCount: normalizedIds.length,
        foundRequestRows: requests.length,
        statuses: Array.from(statusById.entries()),
      })}`,
    );

    return statusById;
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

  private mapRequestStatus(status: RequestStatus): SceneStatusDto['state'] {
    switch (status) {
      case RequestStatus.REQUESTED:
      case RequestStatus.PROCESSING:
        return 'DOWNLOADING';
      case RequestStatus.AVAILABLE:
        return 'AVAILABLE';
      case RequestStatus.FAILED:
        return 'MISSING';
      default:
        this.logger.warn(
          `Unexpected request status "${status}" during fallback mapping.`,
        );
        return 'NOT_REQUESTED';
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
