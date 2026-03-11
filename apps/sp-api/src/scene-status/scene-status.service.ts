import { Injectable } from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  RequestStatus,
} from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { SceneStatusDto } from './dto/scene-status.dto';

@Injectable()
export class SceneStatusService {
  private static readonly UNREQUESTED: SceneStatusDto = {
    state: 'UNREQUESTED',
  };
  private static readonly WHISPARR_BATCH_SIZE = 8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationsService: IntegrationsService,
    private readonly whisparrAdapter: WhisparrAdapter,
  ) {}

  async resolveForScene(stashId: string): Promise<SceneStatusDto> {
    const normalized = stashId.trim();
    if (!normalized) {
      return SceneStatusService.UNREQUESTED;
    }

    const fallback = await this.resolveFallbackStatusForScene(normalized);
    const whisparrConfig = await this.getWhisparrConfig();

    if (!whisparrConfig) {
      return fallback;
    }

    try {
      const whisparrMatch = await this.whisparrAdapter.findSceneByStashId(
        normalized,
        whisparrConfig,
      );

      if (!whisparrMatch) {
        return fallback;
      }

      return {
        state: whisparrMatch.available ? 'AVAILABLE' : 'REQUESTED',
      };
    } catch {
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
      return new Map();
    }

    const fallbackStatuses =
      await this.resolveFallbackStatusesForScenes(normalizedIds);
    const whisparrConfig = await this.getWhisparrConfig();

    if (!whisparrConfig) {
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
            const whisparrMatch = await this.whisparrAdapter.findSceneByStashId(
              stashIdInBatch,
              whisparrConfig,
            );
            return {
              stashId: stashIdInBatch,
              match: whisparrMatch,
            };
          } catch {
            return {
              stashId: stashIdInBatch,
              match: null,
            };
          }
        }),
      );

      for (const result of batchLookups) {
        if (!result.match) {
          continue;
        }

        resolvedStatuses.set(result.stashId, {
          state: result.match.available ? 'AVAILABLE' : 'REQUESTED',
        });
      }
    }

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
      return SceneStatusService.UNREQUESTED;
    }

    return {
      state: this.mapRequestStatus(request.status),
    };
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
        statusById.set(stashId, SceneStatusService.UNREQUESTED);
      }
    }

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
        return null;
      }

      if (integration.status !== IntegrationStatus.CONFIGURED) {
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

  private mapRequestStatus(status: RequestStatus): SceneStatusDto['state'] {
    switch (status) {
      case RequestStatus.REQUESTED:
        return 'REQUESTED';
      case RequestStatus.PROCESSING:
        return 'PROCESSING';
      case RequestStatus.AVAILABLE:
        return 'AVAILABLE';
      case RequestStatus.FAILED:
        return 'FAILED';
      default:
        return 'UNREQUESTED';
    }
  }
}
