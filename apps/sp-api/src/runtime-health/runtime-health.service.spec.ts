import {
  RuntimeHealthServiceKey,
  RuntimeHealthStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RuntimeHealthService } from './runtime-health.service';

describe('RuntimeHealthService', () => {
  const records = new Map<
    RuntimeHealthServiceKey,
    {
      service: RuntimeHealthServiceKey;
      status: RuntimeHealthStatus;
      consecutiveFailures: number;
      lastHealthyAt: Date | null;
      lastFailureAt: Date | null;
      lastErrorMessage: string | null;
      degradedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }
  >();

  const prisma = {
    runtimeIntegrationHealth: {
      findUnique: jest.fn(async ({ where }: { where: { service: RuntimeHealthServiceKey } }) => {
        return records.get(where.service) ?? null;
      }),
      findMany: jest.fn(async () => Array.from(records.values())),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { service: RuntimeHealthServiceKey };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = records.get(where.service);
          const next = {
            ...(existing ?? {
              service: where.service,
              createdAt: new Date('2026-04-02T00:00:00.000Z'),
            }),
            ...(existing ? update : create),
            updatedAt: new Date('2026-04-02T00:00:00.000Z'),
          } as {
            service: RuntimeHealthServiceKey;
            status: RuntimeHealthStatus;
            consecutiveFailures: number;
            lastHealthyAt: Date | null;
            lastFailureAt: Date | null;
            lastErrorMessage: string | null;
            degradedAt: Date | null;
            createdAt: Date;
            updatedAt: Date;
          };

          records.set(where.service, next);
          return next;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { service: RuntimeHealthServiceKey };
          data: Record<string, unknown>;
        }) => {
          const existing = records.get(where.service);
          if (!existing) {
            throw new Error(`Missing runtime health record for ${where.service}`);
          }

          const next = {
            ...existing,
            ...data,
            updatedAt: new Date('2026-04-02T00:00:00.000Z'),
          };
          records.set(where.service, next);
          return next;
        },
      ),
    },
  } as unknown as PrismaService;

  let service: RuntimeHealthService;

  beforeEach(() => {
    records.clear();
    jest.clearAllMocks();
    service = new RuntimeHealthService(prisma);
  });

  it('requires two consecutive failures before marking a service degraded', async () => {
    await service.recordFailure(RuntimeHealthServiceKey.WHISPARR, new Error('timeout'));

    let summary = await service.getSummary();
    expect(summary.degraded).toBe(false);
    expect(summary.services.whisparr.degraded).toBe(false);
    expect(summary.services.whisparr.consecutiveFailures).toBe(1);

    await service.recordFailure(RuntimeHealthServiceKey.WHISPARR, new Error('timeout'));

    summary = await service.getSummary();
    expect(summary.degraded).toBe(true);
    expect(summary.services.whisparr.degraded).toBe(true);
    expect(summary.services.whisparr.status).toBe(RuntimeHealthStatus.DEGRADED);
    expect(summary.services.whisparr.consecutiveFailures).toBe(2);
    expect(summary.services.whisparr.lastErrorMessage).toBe('timeout');
  });

  it('clears degraded state on the first confirmed success', async () => {
    await service.recordFailure(RuntimeHealthServiceKey.STASH, new Error('timeout'));
    await service.recordFailure(RuntimeHealthServiceKey.STASH, new Error('timeout'));

    await service.recordSuccess(RuntimeHealthServiceKey.STASH);

    const summary = await service.getSummary();
    expect(summary.degraded).toBe(false);
    expect(summary.services.stash.degraded).toBe(false);
    expect(summary.services.stash.status).toBe(RuntimeHealthStatus.HEALTHY);
    expect(summary.services.stash.consecutiveFailures).toBe(0);
    expect(summary.services.stash.lastHealthyAt).not.toBeNull();
    expect(summary.services.stash.lastFailureAt).not.toBeNull();
    expect(summary.services.stash.lastErrorMessage).toBe('timeout');
  });

  it('throttles repeated degraded writes for the same error message', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-02T00:00:00.000Z'));

    await service.recordFailure(RuntimeHealthServiceKey.CATALOG, new Error('catalog down'));
    await service.recordFailure(RuntimeHealthServiceKey.CATALOG, new Error('catalog down'));

    const upsertCountAfterDegrade =
      (prisma.runtimeIntegrationHealth.upsert as jest.Mock).mock.calls.length;

    jest.setSystemTime(new Date('2026-04-02T00:00:10.000Z'));
    await service.recordFailure(RuntimeHealthServiceKey.CATALOG, new Error('catalog down'));

    expect(
      (prisma.runtimeIntegrationHealth.upsert as jest.Mock).mock.calls.length,
    ).toBe(upsertCountAfterDegrade);
    jest.useRealTimers();
  });

  it('returns healthy defaults for services without runtime health history', async () => {
    const summary = await service.getSummary();

    expect(summary.degraded).toBe(false);
    expect(summary.failureThreshold).toBe(2);
    expect(summary.services.catalog.degraded).toBe(false);
    expect(summary.services.stash.degraded).toBe(false);
    expect(summary.services.whisparr.degraded).toBe(false);
  });
});
