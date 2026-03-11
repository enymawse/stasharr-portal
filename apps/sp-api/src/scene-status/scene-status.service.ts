import { Injectable } from '@nestjs/common';
import { RequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SceneStatusDto } from './dto/scene-status.dto';

@Injectable()
export class SceneStatusService {
  private static readonly UNREQUESTED: SceneStatusDto = {
    state: 'UNREQUESTED',
  };

  constructor(private readonly prisma: PrismaService) {}

  async resolveForScene(stashId: string): Promise<SceneStatusDto> {
    const normalized = stashId.trim();
    if (!normalized) {
      return SceneStatusService.UNREQUESTED;
    }

    const request = await this.prisma.request.findUnique({
      where: { stashId: normalized },
      select: { status: true },
    });

    if (!request) {
      return SceneStatusService.UNREQUESTED;
    }

    return {
      state: this.mapRequestStatus(request.status),
    };
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
