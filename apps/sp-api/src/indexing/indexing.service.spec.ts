import {
  IntegrationStatus,
  IntegrationType,
  RequestStatus,
  SyncJobStatus,
} from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { INDEXING_JOB_NAMES, IndexingService } from './indexing.service';
import { SyncStateService } from './sync-state.service';

type SceneIndexRow = Record<string, unknown>;
type TransactionOperation = Promise<unknown> | (() => Promise<unknown>);

function buildSceneIndexRow(
  overrides: Record<string, unknown> = {},
): SceneIndexRow {
  return {
    stashId: 'scene-1',
    requestStatus: null,
    requestUpdatedAt: null,
    title: null,
    description: null,
    imageUrl: null,
    studioId: null,
    studioName: null,
    studioImageUrl: null,
    releaseDate: null,
    duration: null,
    whisparrMovieId: null,
    whisparrHasFile: null,
    whisparrQueuePosition: null,
    whisparrQueueStatus: null,
    whisparrQueueState: null,
    whisparrErrorMessage: null,
    stashAvailable: null,
    computedLifecycle: 'NOT_REQUESTED',
    lifecycleSortOrder: 100,
    metadataLastSyncedAt: null,
    whisparrLastSyncedAt: null,
    stashLastSyncedAt: null,
    lastSyncedAt: null,
    createdAt: new Date('2026-03-27T00:00:00.000Z'),
    updatedAt: new Date('2026-03-27T00:00:00.000Z'),
    ...overrides,
  };
}

function matchesScalar(value: unknown, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    return value === filter;
  }

  const record = filter as Record<string, unknown>;
  if (record.in && Array.isArray(record.in)) {
    return record.in.includes(value);
  }
  if (record.notIn && Array.isArray(record.notIn)) {
    return value !== null && !record.notIn.includes(value);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'not')) {
    return value !== record.not;
  }
  if (Object.prototype.hasOwnProperty.call(record, 'gt')) {
    return String(value ?? '') > String(record.gt ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(record, 'lte')) {
    if (value instanceof Date && record.lte instanceof Date) {
      return value.getTime() <= record.lte.getTime();
    }

    return value !== null && value !== undefined && value <= record.lte;
  }

  return value === filter;
}

function matchesWhere(
  row: SceneIndexRow,
  where?: Record<string, unknown>,
): boolean {
  if (!where) {
    return true;
  }

  if (Array.isArray(where.AND)) {
    return where.AND.every((entry) =>
      matchesWhere(row, entry as Record<string, unknown>),
    );
  }

  if (Array.isArray(where.OR)) {
    return where.OR.some((entry) =>
      matchesWhere(row, entry as Record<string, unknown>),
    );
  }

  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND' || key === 'OR') {
      return true;
    }

    return matchesScalar(row[key], value);
  });
}

function sortRows(
  rows: SceneIndexRow[],
  orderBy?:
    | Array<Record<string, 'asc' | 'desc'>>
    | Record<string, 'asc' | 'desc'>,
): SceneIndexRow[] {
  const clauses = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];

  return [...rows].sort((left, right) => {
    for (const clause of clauses) {
      const [field, direction] = Object.entries(clause)[0] ?? [];
      if (!field || !direction) {
        continue;
      }

      const leftValue = left[field] ?? null;
      const rightValue = right[field] ?? null;
      if (leftValue === rightValue) {
        continue;
      }

      if (leftValue === null) {
        return direction === 'asc' ? 1 : -1;
      }
      if (rightValue === null) {
        return direction === 'asc' ? -1 : 1;
      }

      const leftComparable =
        leftValue instanceof Date ? leftValue.getTime() : leftValue;
      const rightComparable =
        rightValue instanceof Date ? rightValue.getTime() : rightValue;

      if (leftComparable < rightComparable) {
        return direction === 'asc' ? -1 : 1;
      }
      if (leftComparable > rightComparable) {
        return direction === 'asc' ? 1 : -1;
      }
    }

    return 0;
  });
}

function applySelect(
  rows: SceneIndexRow[],
  select?: Record<string, boolean>,
): Array<Record<string, unknown>> {
  if (!select) {
    return rows;
  }

  return rows.map((row) => {
    const picked: Record<string, unknown> = {};
    for (const key of Object.keys(select)) {
      if (select[key]) {
        picked[key] = row[key];
      }
    }

    return picked;
  });
}

function createPrismaMock(config: {
  sceneIndexRows?: SceneIndexRow[];
  requestRows?: Array<{
    stashId: string;
    status: RequestStatus;
    updatedAt: Date;
  }>;
  syncStateRow?: Record<string, unknown> | null;
  syncStateRows?: Array<Record<string, unknown>>;
}) {
  const sceneIndexStore = new Map<string, SceneIndexRow>(
    (config.sceneIndexRows ?? []).map((row) => [String(row.stashId), row]),
  );
  const requestRows = config.requestRows ?? [];
  const syncStateStore = new Map<string, Record<string, unknown>>(
    (config.syncStateRows ?? []).map((row) => [String(row.jobName), row]),
  );

  if (config.syncStateRow) {
    const jobName = config.syncStateRow.jobName
      ? String(config.syncStateRow.jobName)
      : INDEXING_JOB_NAMES.METADATA_BACKFILL;
    syncStateStore.set(jobName, {
      jobName,
      ...config.syncStateRow,
    });
  }

  const sceneIndex = {
    findMany: jest.fn(async (args: Record<string, unknown> = {}) => {
      const filtered = Array.from(sceneIndexStore.values()).filter((row) =>
        matchesWhere(row, args.where as Record<string, unknown> | undefined),
      );
      const ordered = sortRows(
        filtered,
        args.orderBy as
          | Array<Record<string, 'asc' | 'desc'>>
          | Record<string, 'asc' | 'desc'>
          | undefined,
      );
      const skipped = ordered.slice(Number(args.skip ?? 0));
      const limited =
        typeof args.take === 'number' ? skipped.slice(0, args.take) : skipped;
      return applySelect(
        limited,
        args.select as Record<string, boolean> | undefined,
      );
    }),
    count: jest.fn(async (args?: Record<string, unknown>) => {
      return Array.from(sceneIndexStore.values()).filter((row) =>
        matchesWhere(row, args?.where as Record<string, unknown> | undefined),
      ).length;
    }),
    upsert: jest.fn(
      (args: {
        where: { stashId: string };
        create: SceneIndexRow;
        update: SceneIndexRow;
      }) =>
        async () => {
          const stashId = args.where.stashId;
          const existing = sceneIndexStore.get(stashId);
          const next = existing
            ? {
                ...existing,
                ...args.update,
                stashId,
              }
            : {
                ...args.create,
                stashId,
              };
          sceneIndexStore.set(stashId, next);
          return next;
        },
    ),
  };

  const request = {
    findMany: jest.fn(async (args?: Record<string, unknown>) => {
      const filter = args?.where as { stashId?: { in?: string[] } } | undefined;
      if (!filter?.stashId?.in) {
        return requestRows;
      }

      return requestRows.filter((row) =>
        filter.stashId?.in?.includes(row.stashId),
      );
    }),
    count: jest.fn(async () => requestRows.length),
  };

  const syncState = {
    findUnique: jest.fn(async (args?: { where?: { jobName?: string } }) => {
      const jobName = args?.where?.jobName;
      if (!jobName) {
        return config.syncStateRow ?? null;
      }

      return syncStateStore.get(jobName) ?? null;
    }),
    findMany: jest.fn(async (args?: Record<string, unknown>) => {
      const jobNames = ((args?.where as { jobName?: { in?: string[] } })
        ?.jobName?.in ?? null) as string[] | null;
      const rows = Array.from(syncStateStore.values());
      if (!jobNames) {
        return rows;
      }

      return rows.filter((row) => jobNames.includes(String(row.jobName)));
    }),
  };

  return {
    prisma: {
      sceneIndex,
      request,
      syncState,
      $transaction: jest.fn(async (operations: TransactionOperation[]) =>
        Promise.all(
          operations.map((operation) =>
            typeof operation === 'function' ? operation() : operation,
          ),
        ),
      ),
    } as unknown as PrismaService,
    sceneIndexStore,
  };
}

describe('IndexingService', () => {
  const findOneMock = jest.fn();
  const getMovieSnapshotMock = jest.fn();
  const getQueueSnapshotMock = jest.fn();
  const findMovieByIdMock = jest.fn();
  const getLocalSceneIdentityPageMock = jest.fn();
  const getSceneMetadataByIdsMock = jest.fn();
  const runWithLeaseMock = jest.fn();
  const recordSuccessMock = jest.fn();

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const whisparrAdapter = {
    getMovieSnapshot: getMovieSnapshotMock,
    getQueueSnapshot: getQueueSnapshotMock,
    findMovieById: findMovieByIdMock,
  } as unknown as WhisparrAdapter;

  const stashAdapter = {
    getLocalSceneIdentityPage: getLocalSceneIdentityPageMock,
  } as unknown as StashAdapter;

  const stashdbAdapter = {
    getSceneMetadataByIds: getSceneMetadataByIdsMock,
  } as unknown as StashdbAdapter;

  const syncStateService = {
    runWithLease: runWithLeaseMock,
    recordSuccess: recordSuccessMock,
  } as unknown as SyncStateService;

  const configuredWhisparrIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://whisparr.local',
    apiKey: 'wh-key',
  };

  const configuredStashIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stash.local',
    apiKey: 'stash-key',
  };

  const configuredStashdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stashdb.local',
    apiKey: 'stashdb-key',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    runWithLeaseMock.mockImplementation(
      async (_config: unknown, handler: () => Promise<unknown>) => handler(),
    );
    findOneMock.mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.WHISPARR) {
        return configuredWhisparrIntegration;
      }

      if (type === IntegrationType.STASH) {
        return configuredStashIntegration;
      }

      if (type === IntegrationType.STASHDB) {
        return configuredStashdbIntegration;
      }

      throw new Error(`Unexpected integration type: ${type}`);
    });
    getMovieSnapshotMock.mockResolvedValue([]);
    getQueueSnapshotMock.mockResolvedValue([]);
    findMovieByIdMock.mockResolvedValue(null);
    recordSuccessMock.mockResolvedValue(undefined);
    getLocalSceneIdentityPageMock.mockResolvedValue({
      total: 0,
      page: 1,
      perPage: 250,
      hasMore: false,
      items: [],
    });
    getSceneMetadataByIdsMock.mockImplementation((stashIds: string[]) =>
      Promise.resolve(
        stashIds.map((stashId) => ({
          id: stashId,
          title: `Title ${stashId}`,
          details: `Description ${stashId}`,
          imageUrl: `http://image/${stashId}`,
          studioId: 'studio-1',
          studioName: 'Studio',
          studioImageUrl: 'http://studio/image',
          releaseDate: '2026-03-27',
          duration: 720,
        })),
      ),
    );
  });

  it('bootstraps a fresh request row into the local scene index', async () => {
    const { prisma, sceneIndexStore } = createPrismaMock({
      requestRows: [
        {
          stashId: 'scene-1',
          status: RequestStatus.REQUESTED,
          updatedAt: new Date('2026-03-27T00:00:00.000Z'),
        },
      ],
    });
    const service = new IndexingService(
      prisma,
      integrationsService,
      whisparrAdapter,
      stashAdapter,
      stashdbAdapter,
      syncStateService,
    );

    await service.bootstrapIndex('test');

    expect(sceneIndexStore.get('scene-1')).toEqual(
      expect.objectContaining({
        stashId: 'scene-1',
        requestStatus: RequestStatus.REQUESTED,
        title: 'Title scene-1',
        computedLifecycle: 'REQUESTED',
      }),
    );
    expect(getSceneMetadataByIdsMock).toHaveBeenCalledWith(
      ['scene-1'],
      expect.objectContaining({
        baseUrl: 'http://stashdb.local',
      }),
    );
  });

  it('syncs Whisparr queue state into the scene index lifecycle', async () => {
    const { prisma, sceneIndexStore } = createPrismaMock({
      sceneIndexRows: [
        buildSceneIndexRow({
          stashId: 'scene-1',
          requestStatus: RequestStatus.REQUESTED,
          whisparrMovieId: 10,
          whisparrHasFile: false,
          computedLifecycle: 'REQUESTED',
          lifecycleSortOrder: 3,
        }),
      ],
    });
    getQueueSnapshotMock.mockResolvedValue([
      {
        movieId: 10,
        status: 'downloading',
        trackedDownloadState: 'Downloading',
        trackedDownloadStatus: 'Ok',
        errorMessage: null,
      },
    ]);

    const service = new IndexingService(
      prisma,
      integrationsService,
      whisparrAdapter,
      stashAdapter,
      stashdbAdapter,
      syncStateService,
    );

    await service.syncWhisparrQueue('test');

    expect(sceneIndexStore.get('scene-1')).toEqual(
      expect.objectContaining({
        whisparrQueueStatus: 'downloading',
        whisparrQueueState: 'Downloading',
        computedLifecycle: 'DOWNLOADING',
      }),
    );
  });

  it('syncs Whisparr movie snapshot into durable movie fields', async () => {
    const { prisma, sceneIndexStore } = createPrismaMock({
      requestRows: [
        {
          stashId: 'scene-1',
          status: RequestStatus.REQUESTED,
          updatedAt: new Date('2026-03-27T00:00:00.000Z'),
        },
      ],
    });
    getMovieSnapshotMock.mockResolvedValue([
      {
        movieId: 22,
        stashId: 'scene-1',
        hasFile: true,
      },
    ]);

    const service = new IndexingService(
      prisma,
      integrationsService,
      whisparrAdapter,
      stashAdapter,
      stashdbAdapter,
      syncStateService,
    );

    await service.syncWhisparrMovies('test');

    expect(sceneIndexStore.get('scene-1')).toEqual(
      expect.objectContaining({
        whisparrMovieId: 22,
        whisparrHasFile: true,
        computedLifecycle: 'IMPORT_PENDING',
      }),
    );
  });

  it('reconciles Stash availability from the paginated bulk snapshot path', async () => {
    const { prisma, sceneIndexStore } = createPrismaMock({
      sceneIndexRows: [
        buildSceneIndexRow({
          stashId: 'scene-1',
          requestStatus: RequestStatus.REQUESTED,
          computedLifecycle: 'REQUESTED',
          lifecycleSortOrder: 3,
        }),
        buildSceneIndexRow({
          stashId: 'scene-stale',
          stashAvailable: true,
          computedLifecycle: 'AVAILABLE',
          lifecycleSortOrder: 90,
        }),
      ],
    });
    getLocalSceneIdentityPageMock
      .mockResolvedValueOnce({
        total: 3,
        page: 1,
        perPage: 250,
        hasMore: true,
        items: [
          {
            id: 'local-1',
            linkedStashIds: [
              {
                endpoint: 'https://stashdb.org/graphql',
                stashId: 'scene-1',
              },
            ],
          },
          {
            id: 'local-2',
            linkedStashIds: [
              {
                endpoint: 'https://stashdb.org/graphql',
                stashId: 'scene-2',
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        total: 3,
        page: 2,
        perPage: 250,
        hasMore: false,
        items: [
          {
            id: 'local-3',
            linkedStashIds: [],
          },
        ],
      });

    const service = new IndexingService(
      prisma,
      integrationsService,
      whisparrAdapter,
      stashAdapter,
      stashdbAdapter,
      syncStateService,
    );

    await service.syncStashAvailability('test');

    expect(getLocalSceneIdentityPageMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        baseUrl: 'http://stash.local',
      }),
      {
        page: 1,
        perPage: 250,
      },
    );
    expect(getLocalSceneIdentityPageMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        baseUrl: 'http://stash.local',
      }),
      {
        page: 2,
        perPage: 250,
      },
    );
    expect(sceneIndexStore.get('scene-1')).toEqual(
      expect.objectContaining({
        stashAvailable: true,
        computedLifecycle: 'AVAILABLE',
      }),
    );
    expect(sceneIndexStore.get('scene-2')).toEqual(
      expect.objectContaining({
        stashId: 'scene-2',
        stashAvailable: true,
        computedLifecycle: 'AVAILABLE',
      }),
    );
    expect(sceneIndexStore.get('scene-stale')).toEqual(
      expect.objectContaining({
        stashAvailable: false,
        computedLifecycle: 'NOT_REQUESTED',
      }),
    );
  });

  it('retries a deadlocked stash availability scene-index batch', async () => {
    const { prisma, sceneIndexStore } = createPrismaMock({
      sceneIndexRows: [
        buildSceneIndexRow({
          stashId: 'scene-1',
          requestStatus: RequestStatus.REQUESTED,
          computedLifecycle: 'REQUESTED',
          lifecycleSortOrder: 3,
        }),
      ],
    });
    const transactionMock = prisma.$transaction as jest.Mock;
    const executeTransaction = transactionMock.getMockImplementation();
    let attempts = 0;

    transactionMock.mockImplementation(
      async (operations: TransactionOperation[]) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('DriverAdapterError: deadlock detected');
        }

        return executeTransaction?.(operations);
      },
    );
    getLocalSceneIdentityPageMock.mockResolvedValue({
      total: 1,
      page: 1,
      perPage: 250,
      hasMore: false,
      items: [
        {
          id: 'local-1',
          linkedStashIds: [
            {
              endpoint: 'https://stashdb.org/graphql',
              stashId: 'scene-1',
            },
          ],
        },
      ],
    });

    const service = new IndexingService(
      prisma,
      integrationsService,
      whisparrAdapter,
      stashAdapter,
      stashdbAdapter,
      syncStateService,
    );

    await service.syncStashAvailability('test', ['scene-1']);

    expect(attempts).toBe(2);
    expect(sceneIndexStore.get('scene-1')).toEqual(
      expect.objectContaining({
        stashAvailable: true,
        computedLifecycle: 'AVAILABLE',
      }),
    );
  });

  it('trusts missing scenes as NOT_REQUESTED when the evidence index is fresh and comprehensive', async () => {
    const now = Date.now();
    const { prisma } = createPrismaMock({
      syncStateRows: [
        {
          jobName: INDEXING_JOB_NAMES.REQUEST_ROWS,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 30_000),
        },
        {
          jobName: INDEXING_JOB_NAMES.WHISPARR_MOVIES,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 5 * 60_000),
        },
        {
          jobName: INDEXING_JOB_NAMES.STASH_AVAILABILITY,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 5 * 60_000),
        },
      ],
    });
    const service = new IndexingService(
      prisma,
      integrationsService,
      whisparrAdapter,
      stashAdapter,
      stashdbAdapter,
      syncStateService,
    );

    await expect(service.canResolveUnknownScenesAsNotRequested()).resolves.toBe(
      true,
    );
  });

  it('keeps remote fallback enabled when a required evidence snapshot is stale', async () => {
    const now = Date.now();
    const { prisma } = createPrismaMock({
      syncStateRows: [
        {
          jobName: INDEXING_JOB_NAMES.REQUEST_ROWS,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 30_000),
        },
        {
          jobName: INDEXING_JOB_NAMES.WHISPARR_MOVIES,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 5 * 60_000),
        },
        {
          jobName: INDEXING_JOB_NAMES.STASH_AVAILABILITY,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 16 * 60_000),
        },
      ],
    });
    const service = new IndexingService(
      prisma,
      integrationsService,
      whisparrAdapter,
      stashAdapter,
      stashdbAdapter,
      syncStateService,
    );

    await expect(service.canResolveUnknownScenesAsNotRequested()).resolves.toBe(
      false,
    );
  });

  it('runs metadata backfill on the accelerated 10-second cadence while metadata is missing', async () => {
    const { prisma } = createPrismaMock({
      sceneIndexRows: [
        buildSceneIndexRow({
          stashId: 'scene-1',
          title: null,
          imageUrl: null,
          studioName: null,
          metadataLastSyncedAt: null,
        }),
      ],
      syncStateRow: {
        lastSuccessAt: new Date(Date.now() - 11_000),
      },
    });
    const service = new IndexingService(
      prisma,
      integrationsService,
      whisparrAdapter,
      stashAdapter,
      stashdbAdapter,
      syncStateService,
    );

    await service.syncMetadataBackfill('interval');

    expect(runWithLeaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobName: 'scene-index-metadata-backfill',
      }),
      expect.any(Function),
    );
    expect(getSceneMetadataByIdsMock).toHaveBeenCalledWith(
      ['scene-1'],
      expect.objectContaining({
        baseUrl: 'http://stashdb.local',
      }),
    );
  });

  it('skips scheduled metadata backfill when fully hydrated and the 30-minute steady interval has not elapsed', async () => {
    const { prisma } = createPrismaMock({
      sceneIndexRows: [
        buildSceneIndexRow({
          stashId: 'scene-1',
          title: 'Title scene-1',
          imageUrl: 'http://image/scene-1',
          studioName: 'Studio',
          metadataLastSyncedAt: new Date('2026-03-27T00:00:00.000Z'),
        }),
      ],
      syncStateRow: {
        lastSuccessAt: new Date(Date.now() - 5 * 60_000),
      },
    });
    const service = new IndexingService(
      prisma,
      integrationsService,
      whisparrAdapter,
      stashAdapter,
      stashdbAdapter,
      syncStateService,
    );

    const result = await service.syncMetadataBackfill('interval');

    expect(result).toBeNull();
    expect(runWithLeaseMock).not.toHaveBeenCalled();
    expect(getSceneMetadataByIdsMock).not.toHaveBeenCalled();
  });
});
