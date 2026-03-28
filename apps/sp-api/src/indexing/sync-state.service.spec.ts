import { SyncJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SyncStateService } from './sync-state.service';

describe('SyncStateService', () => {
  const syncStateStore = new Map<string, Record<string, unknown>>();

  const prisma = {
    syncState: {
      findMany: jest.fn(async () =>
        Array.from(syncStateStore.values()).sort((left, right) =>
          String(left.jobName).localeCompare(String(right.jobName)),
        ),
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { jobName: string } }) =>
          syncStateStore.get(where.jobName) ?? null,
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { jobName: string };
          create: Record<string, unknown>;
          update?: Record<string, unknown>;
        }) => {
          const existing = syncStateStore.get(where.jobName);
          if (existing) {
            const next = {
              ...existing,
              ...(update ?? {}),
            };
            syncStateStore.set(where.jobName, next);
            return next;
          }

          const next = {
            jobName: where.jobName,
            status: SyncJobStatus.IDLE,
            startedAt: null,
            finishedAt: null,
            leaseUntil: null,
            cursor: null,
            lastError: null,
            lastSuccessAt: null,
            lastDurationMs: null,
            lastProcessedCount: null,
            lastUpdatedCount: null,
            lastRunReason: null,
            createdAt: new Date('2026-03-27T00:00:00.000Z'),
            updatedAt: new Date('2026-03-27T00:00:00.000Z'),
            ...create,
          };
          syncStateStore.set(where.jobName, next);
          return next;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            jobName: string;
            OR: Array<{ leaseUntil: null } | { leaseUntil: { lte: Date } }>;
          };
          data: Record<string, unknown>;
        }) => {
          const existing = syncStateStore.get(where.jobName);
          if (!existing) {
            return { count: 0 };
          }

          const leaseUntil = existing.leaseUntil as Date | null;
          const claimable = where.OR.some((condition) => {
            if ('leaseUntil' in condition && condition.leaseUntil === null) {
              return leaseUntil === null;
            }

            const nextLease = (condition as { leaseUntil: { lte: Date } })
              .leaseUntil;
            return (
              leaseUntil instanceof Date &&
              leaseUntil.getTime() <= nextLease.lte.getTime()
            );
          });

          if (!claimable) {
            return { count: 0 };
          }

          syncStateStore.set(where.jobName, {
            ...existing,
            ...data,
          });
          return { count: 1 };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { jobName: string };
          data: Record<string, unknown>;
        }) => {
          const existing = syncStateStore.get(where.jobName);
          if (!existing) {
            throw new Error(`Missing sync state: ${where.jobName}`);
          }

          const next = {
            ...existing,
            ...data,
          };
          syncStateStore.set(where.jobName, next);
          return next;
        },
      ),
    },
  } as unknown as PrismaService;

  let service: SyncStateService;

  beforeEach(() => {
    syncStateStore.clear();
    jest.clearAllMocks();
    service = new SyncStateService(prisma);
  });

  it('prevents concurrent runs of the same job lease', async () => {
    let releaseFirstRun!: () => void;
    const firstRunBlocker = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });
    const firstRun = service.runWithLease(
      {
        jobName: 'queue-sync',
        leaseMs: 60_000,
      },
      async () => {
        await firstRunBlocker;
        return 'first';
      },
    );
    await Promise.resolve();

    const secondRun = await service.runWithLease(
      {
        jobName: 'queue-sync',
        leaseMs: 60_000,
      },
      async () => 'second',
    );

    expect(secondRun).toBeNull();

    releaseFirstRun();
    await expect(firstRun).resolves.toBe('first');
    await expect(service.listStates()).resolves.toEqual([
      expect.objectContaining({
        jobName: 'queue-sync',
        status: SyncJobStatus.SUCCEEDED,
      }),
    ]);
  });

  it('records success for standalone sync markers without an acquired lease row', async () => {
    await service.recordSuccess('request-sync', {
      processedCount: 4,
      updatedCount: 2,
      durationMs: 150,
      runReason: 'manual',
    });

    await expect(service.listStates()).resolves.toEqual([
      expect.objectContaining({
        jobName: 'request-sync',
        status: SyncJobStatus.SUCCEEDED,
        lastProcessedCount: 4,
        lastUpdatedCount: 2,
        lastDurationMs: 150,
        lastRunReason: 'manual',
      }),
    ]);
  });

  it('records duration, counts, and reason from leased runs', async () => {
    await service.runWithLease(
      {
        jobName: 'movie-sync',
        leaseMs: 60_000,
        onSuccess: (_result, context) => ({
          processedCount: 10,
          updatedCount: 3,
          durationMs: context.durationMs,
          runReason: 'interval',
          cursor: 'scene-10',
        }),
      },
      async () => 'ok',
    );

    await expect(service.listStates()).resolves.toEqual([
      expect.objectContaining({
        jobName: 'movie-sync',
        status: SyncJobStatus.SUCCEEDED,
        lastProcessedCount: 10,
        lastUpdatedCount: 3,
        lastRunReason: 'interval',
        cursor: 'scene-10',
      }),
    ]);
  });
});
