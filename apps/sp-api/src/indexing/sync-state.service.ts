import { Injectable, Logger } from '@nestjs/common';
import { Prisma, SyncJobStatus, SyncState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SyncStateService {
  private readonly logger = new Logger(SyncStateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async runWithLease<T>(
    config: {
      jobName: string;
      leaseMs: number;
      onSuccessCursor?: (result: T) => string | null | undefined;
    },
    handler: () => Promise<T>,
  ): Promise<T | null> {
    const lease = await this.tryAcquireLease(config.jobName, config.leaseMs);
    if (!lease) {
      this.logger.debug(`Skipping overlapping sync job: ${config.jobName}`);
      return null;
    }

    try {
      const result = await handler();
      await this.markSuccess(
        config.jobName,
        config.onSuccessCursor?.(result) ?? undefined,
      );
      return result;
    } catch (error) {
      await this.markFailure(config.jobName, error);
      throw error;
    }
  }

  async listStates(): Promise<SyncState[]> {
    return this.prisma.syncState.findMany({
      orderBy: {
        jobName: 'asc',
      },
    });
  }

  async tryAcquireLease(
    jobName: string,
    leaseMs: number,
  ): Promise<SyncState | null> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + leaseMs);

    await this.prisma.syncState.upsert({
      where: { jobName },
      create: {
        jobName,
      },
      update: {},
    });

    const claim = await this.prisma.syncState.updateMany({
      where: {
        jobName,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      },
      data: {
        status: SyncJobStatus.RUNNING,
        startedAt: now,
        finishedAt: null,
        leaseUntil,
        lastError: null,
      },
    });

    if (claim.count === 0) {
      return null;
    }

    return this.prisma.syncState.findUnique({
      where: { jobName },
    });
  }

  async markSuccess(
    jobName: string,
    cursor?: string | null,
  ): Promise<void> {
    const now = new Date();
    const data: Prisma.SyncStateUpdateInput = {
      status: SyncJobStatus.SUCCEEDED,
      finishedAt: now,
      leaseUntil: null,
      lastSuccessAt: now,
      lastError: null,
    };

    if (cursor !== undefined) {
      data.cursor = cursor;
    }

    await this.prisma.syncState.update({
      where: { jobName },
      data,
    });
  }

  async markFailure(jobName: string, error: unknown): Promise<void> {
    const now = new Date();
    await this.prisma.syncState.update({
      where: { jobName },
      data: {
        status: SyncJobStatus.FAILED,
        finishedAt: now,
        leaseUntil: null,
        lastError: this.serializeError(error),
      },
    });
  }

  private serializeError(error: unknown): string {
    if (error instanceof Error) {
      const message = error.stack ?? error.message;
      return message.length > 4000
        ? `${message.slice(0, 4000)}...(truncated)`
        : message;
    }

    try {
      const serialized = JSON.stringify(error);
      if (!serialized) {
        return 'Unknown error';
      }

      return serialized.length > 4000
        ? `${serialized.slice(0, 4000)}...(truncated)`
        : serialized;
    } catch {
      return 'Unknown error';
    }
  }
}
