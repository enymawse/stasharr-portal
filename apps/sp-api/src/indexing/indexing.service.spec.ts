import {
  IntegrationStatus,
  IntegrationType,
  MetadataHydrationState,
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
type LibrarySceneIndexRow = Record<string, unknown>;
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
    metadataHydrationState: MetadataHydrationState.PENDING,
    metadataLastSyncedAt: null,
    metadataRetryAfterAt: null,
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
  if (Object.prototype.hasOwnProperty.call(record, 'lt')) {
    if (value instanceof Date && record.lt instanceof Date) {
      return value.getTime() < record.lt.getTime();
    }

    return value !== null && value !== undefined && value < record.lt;
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
  librarySceneIndexRows?: LibrarySceneIndexRow[];
  requestRows?: Array<{
    stashId: string;
    status: RequestStatus;
    updatedAt: Date;
  }>;
  syncStateRow?: Record<string, unknown> | null;
  syncStateRows?: Array<Record<string, unknown>>;
  sceneIndexSummaryRow?: Record<string, unknown> | null;
}) {
  const sceneIndexStore = new Map<string, SceneIndexRow>(
    (config.sceneIndexRows ?? []).map((row) => [String(row.stashId), row]),
  );
  const librarySceneIndexStore = new Map<string, LibrarySceneIndexRow>(
    (config.librarySceneIndexRows ?? []).map((row) => [
      String(row.stashSceneId),
      row,
    ]),
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

  const sceneIndexSummaryStore = new Map<string, Record<string, unknown>>();
  if (config.sceneIndexSummaryRow) {
    const key = config.sceneIndexSummaryRow.key
      ? String(config.sceneIndexSummaryRow.key)
      : 'GLOBAL';
    sceneIndexSummaryStore.set(key, {
      key,
      indexedScenes: 0,
      acquisitionTrackedScenes: 0,
      requestedCount: 0,
      downloadingCount: 0,
      importPendingCount: 0,
      failedCount: 0,
      metadataPendingCount: 0,
      metadataRetryableCount: 0,
      lastIndexWriteAt: null,
      createdAt: new Date('2026-03-27T00:00:00.000Z'),
      updatedAt: new Date('2026-03-27T00:00:00.000Z'),
      ...config.sceneIndexSummaryRow,
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
    findFirst: jest.fn(async (args?: Record<string, unknown>) => {
      const filtered = Array.from(sceneIndexStore.values()).filter((row) =>
        matchesWhere(row, args?.where as Record<string, unknown> | undefined),
      );
      const ordered = sortRows(
        filtered,
        args?.orderBy as Record<string, 'asc' | 'desc'> | undefined,
      );
      const first = ordered[0];
      if (!first) {
        return null;
      }

      return (
        applySelect(
          [first],
          args?.select as Record<string, boolean> | undefined,
        )[0] ?? null
      );
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

  const sceneIndexSummary = {
    findUnique: jest.fn(async (args?: { where?: { key?: string } }) => {
      const key = args?.where?.key;
      if (!key) {
        return null;
      }

      return sceneIndexSummaryStore.get(key) ?? null;
    }),
    update: jest.fn(
      (args: { where: { key: string }; data: Record<string, unknown> }) =>
        async () => {
          const existing = sceneIndexSummaryStore.get(args.where.key);
          if (!existing) {
            throw new Error(`Missing scene index summary: ${args.where.key}`);
          }

          const next = {
            ...existing,
            ...Object.fromEntries(
              Object.entries(args.data).map(([field, value]) => {
                if (
                  value &&
                  typeof value === 'object' &&
                  !Array.isArray(value) &&
                  Object.prototype.hasOwnProperty.call(value, 'increment')
                ) {
                  return [
                    field,
                    Number(existing[field] ?? 0) +
                      Number((value as { increment?: number }).increment ?? 0),
                  ];
                }

                return [field, value];
              }),
            ),
          };
          sceneIndexSummaryStore.set(args.where.key, next);
          return next;
        },
    ),
    upsert: jest.fn(
      async (args: {
        where: { key: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const existing = sceneIndexSummaryStore.get(args.where.key);
        const next = existing
          ? {
              ...existing,
              ...args.update,
            }
          : {
              key: args.where.key,
              ...args.create,
            };
        sceneIndexSummaryStore.set(args.where.key, next);
        return next;
      },
    ),
  };

  const librarySceneIndex = {
    findMany: jest.fn(async (args: Record<string, unknown> = {}) => {
      const filtered = Array.from(librarySceneIndexStore.values()).filter(
        (row) =>
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
      return Array.from(librarySceneIndexStore.values()).filter((row) =>
        matchesWhere(row, args?.where as Record<string, unknown> | undefined),
      ).length;
    }),
    upsert: jest.fn(
      (args: {
        where: { stashSceneId: string };
        create: LibrarySceneIndexRow;
        update: LibrarySceneIndexRow;
      }) =>
        async () => {
          const stashSceneId = args.where.stashSceneId;
          const existing = librarySceneIndexStore.get(stashSceneId);
          const next = existing
            ? {
                ...existing,
                ...args.update,
                stashSceneId,
              }
            : {
                ...args.create,
                stashSceneId,
              };
          librarySceneIndexStore.set(stashSceneId, next);
          return next;
        },
    ),
    deleteMany: jest.fn(async (args?: Record<string, unknown>) => {
      const matchingIds = Array.from(librarySceneIndexStore.values())
        .filter((row) =>
          matchesWhere(row, args?.where as Record<string, unknown> | undefined),
        )
        .map((row) => String(row.stashSceneId));
      for (const id of matchingIds) {
        librarySceneIndexStore.delete(id);
      }

      return { count: matchingIds.length };
    }),
  };

  return {
    prisma: {
      sceneIndex,
      librarySceneIndex,
      sceneIndexSummary,
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
    librarySceneIndexStore,
    sceneIndexSummaryStore,
  };
}

describe('IndexingService', () => {
  const findOneMock = jest.fn();
  const getMovieSnapshotMock = jest.fn();
  const getQueueSnapshotMock = jest.fn();
  const findMovieByStashIdMock = jest.fn();
  const findMovieByIdMock = jest.fn();
  const findScenesByStashIdMock = jest.fn();
  const getLocalSceneIdentityPageMock = jest.fn();
  const getLocalLibraryScenePageMock = jest.fn();
  const getSceneMetadataByIdsMock = jest.fn();
  const runWithLeaseMock = jest.fn();
  const recordSuccessMock = jest.fn();

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const whisparrAdapter = {
    getMovieSnapshot: getMovieSnapshotMock,
    getQueueSnapshot: getQueueSnapshotMock,
    findMovieByStashId: findMovieByStashIdMock,
    findMovieById: findMovieByIdMock,
  } as unknown as WhisparrAdapter;

  const stashAdapter = {
    findScenesByStashId: findScenesByStashIdMock,
    getLocalSceneIdentityPage: getLocalSceneIdentityPageMock,
    getLocalLibraryScenePage: getLocalLibraryScenePageMock,
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
    findMovieByStashIdMock.mockResolvedValue(null);
    findMovieByIdMock.mockResolvedValue(null);
    findScenesByStashIdMock.mockResolvedValue([]);
    recordSuccessMock.mockResolvedValue(undefined);
    getLocalSceneIdentityPageMock.mockResolvedValue({
      total: 0,
      page: 1,
      perPage: 250,
      hasMore: false,
      items: [],
    });
    getLocalLibraryScenePageMock.mockResolvedValue({
      total: 0,
      page: 1,
      perPage: 100,
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

  it('syncs the local-library projection and reconciles linked stash availability', async () => {
    const { prisma, sceneIndexStore, librarySceneIndexStore } =
      createPrismaMock({
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
    getLocalLibraryScenePageMock
      .mockResolvedValueOnce({
        total: 3,
        page: 1,
        perPage: 100,
        hasMore: true,
        items: [
          {
            id: 'local-1',
            linkedStashId: 'scene-1',
            linkedCatalogRefs: ['STASHDB|scene-1', 'FANSDB|scene-1'],
            title: 'Local Scene One',
            description: 'Already local.',
            imageUrl: 'http://stash.local/images/local-1.jpg',
            studioId: 'studio-1',
            studio: 'Archive',
            studioImageUrl: 'http://stash.local/studios/archive.jpg',
            performerIds: ['performer-1'],
            performerNames: ['Performer One'],
            tagIds: ['tag-1'],
            tagNames: ['Tag One'],
            releaseDate: '2026-03-24',
            duration: 1800,
            viewUrl: 'http://stash.local/scenes/local-1',
            createdAt: new Date('2026-03-23T00:00:00.000Z'),
            updatedAt: new Date('2026-03-24T00:00:00.000Z'),
            hasFavoritePerformer: false,
            favoriteStudio: false,
            hasFavoriteTag: false,
          },
          {
            id: 'local-2',
            linkedStashId: null,
            linkedCatalogRefs: ['FANSDB|scene-2'],
            title: 'Local Scene Two',
            description: null,
            imageUrl: null,
            studioId: null,
            studio: null,
            studioImageUrl: null,
            performerIds: [],
            performerNames: [],
            tagIds: [],
            tagNames: [],
            releaseDate: null,
            duration: null,
            viewUrl: 'http://stash.local/scenes/local-2',
            createdAt: null,
            updatedAt: null,
            hasFavoritePerformer: false,
            favoriteStudio: false,
            hasFavoriteTag: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        total: 3,
        page: 2,
        perPage: 100,
        hasMore: false,
        items: [
          {
            id: 'local-3',
            linkedStashId: null,
            linkedCatalogRefs: [],
            title: 'Unlinked Local Scene',
            description: null,
            imageUrl: null,
            studioId: null,
            studio: null,
            studioImageUrl: null,
            performerIds: [],
            performerNames: [],
            tagIds: [],
            tagNames: [],
            releaseDate: null,
            duration: null,
            viewUrl: 'http://stash.local/scenes/local-3',
            createdAt: null,
            updatedAt: null,
            hasFavoritePerformer: false,
            favoriteStudio: false,
            hasFavoriteTag: false,
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

    expect(getLocalLibraryScenePageMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        baseUrl: 'http://stash.local',
      }),
      {
        page: 1,
        perPage: 100,
      },
      'STASHDB',
    );
    expect(getLocalLibraryScenePageMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        baseUrl: 'http://stash.local',
      }),
      {
        page: 2,
        perPage: 100,
      },
      'STASHDB',
    );
    expect(librarySceneIndexStore.get('local-1')).toEqual(
      expect.objectContaining({
        stashSceneId: 'local-1',
        linkedStashId: 'scene-1',
        linkedCatalogRefs: ['STASHDB|scene-1', 'FANSDB|scene-1'],
        title: 'Local Scene One',
        tagIds: ['tag-1'],
        lastSyncedAt: expect.any(Date),
      }),
    );
    expect(sceneIndexStore.get('scene-1')).toEqual(
      expect.objectContaining({
        stashAvailable: true,
        computedLifecycle: 'AVAILABLE',
      }),
    );
    expect(sceneIndexStore.get('scene-2')).toBeUndefined();
    expect(sceneIndexStore.get('scene-stale')).toEqual(
      expect.objectContaining({
        stashAvailable: false,
        computedLifecycle: 'NOT_REQUESTED',
      }),
    );
  });

  it('retries a deadlocked targeted stash-availability scene-index batch', async () => {
    const { prisma, sceneIndexStore } = createPrismaMock({
      sceneIndexRows: [
        buildSceneIndexRow({
          stashId: 'scene-1',
          requestStatus: RequestStatus.REQUESTED,
          computedLifecycle: 'REQUESTED',
          lifecycleSortOrder: 3,
        }),
      ],
      sceneIndexSummaryRow: {
        key: 'GLOBAL',
        indexedScenes: 1,
        acquisitionTrackedScenes: 1,
        requestedCount: 1,
        downloadingCount: 0,
        importPendingCount: 0,
        failedCount: 0,
        metadataPendingCount: 1,
        metadataRetryableCount: 0,
      },
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
    findScenesByStashIdMock.mockResolvedValue([{ id: 'local-1' }]);

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
          jobName: INDEXING_JOB_NAMES.LIBRARY_PROJECTION,
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
          jobName: INDEXING_JOB_NAMES.LIBRARY_PROJECTION,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 21 * 60_000),
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

  it('uses targeted provider lookups for immediate refresh without triggering broad snapshots', async () => {
    const { prisma, sceneIndexStore } = createPrismaMock({
      sceneIndexRows: [
        buildSceneIndexRow({
          stashId: 'scene-1',
          requestStatus: RequestStatus.REQUESTED,
          computedLifecycle: 'REQUESTED',
          lifecycleSortOrder: 3,
        }),
      ],
      requestRows: [
        {
          stashId: 'scene-1',
          status: RequestStatus.REQUESTED,
          updatedAt: new Date('2026-03-27T00:00:00.000Z'),
        },
      ],
    });
    findMovieByStashIdMock.mockResolvedValue({
      movieId: 77,
      stashId: 'scene-1',
      hasFile: false,
    });
    findScenesByStashIdMock.mockResolvedValue([
      {
        id: 'local-1',
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

    await service.requestImmediateRefresh(['scene-1'], 'request-submitted');

    expect(findMovieByStashIdMock).toHaveBeenCalledWith(
      'scene-1',
      expect.objectContaining({
        baseUrl: 'http://whisparr.local',
      }),
    );
    expect(findScenesByStashIdMock).toHaveBeenCalledWith(
      'scene-1',
      expect.objectContaining({
        baseUrl: 'http://stash.local',
      }),
      {
        providerKey: 'STASHDB',
      },
    );
    expect(getQueueSnapshotMock).not.toHaveBeenCalled();
    expect(getMovieSnapshotMock).not.toHaveBeenCalled();
    expect(getLocalLibraryScenePageMock).not.toHaveBeenCalled();
    expect(sceneIndexStore.get('scene-1')).toEqual(
      expect.objectContaining({
        whisparrMovieId: 77,
        stashAvailable: true,
      }),
    );
  });

  it('exposes persisted sync metrics and freshness details in indexing status', async () => {
    const now = Date.now();
    const { prisma } = createPrismaMock({
      syncStateRows: [
        {
          jobName: INDEXING_JOB_NAMES.REQUEST_ROWS,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 30_000),
          lastDurationMs: 120,
          lastProcessedCount: 3,
          lastUpdatedCount: 3,
          lastRunReason: 'request-sync',
        },
        {
          jobName: INDEXING_JOB_NAMES.WHISPARR_MOVIES,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 2 * 60_000),
          lastDurationMs: 1_500,
          lastProcessedCount: 40,
          lastUpdatedCount: 12,
          lastRunReason: 'interval',
        },
        {
          jobName: INDEXING_JOB_NAMES.LIBRARY_PROJECTION,
          status: SyncJobStatus.SUCCEEDED,
          lastSuccessAt: new Date(now - 2 * 60_000),
          lastDurationMs: 900,
          lastProcessedCount: 50,
          lastUpdatedCount: 8,
          lastRunReason: 'interval',
        },
      ],
      sceneIndexSummaryRow: {
        key: 'GLOBAL',
        indexedScenes: 120,
        acquisitionTrackedScenes: 14,
        requestedCount: 4,
        downloadingCount: 5,
        importPendingCount: 3,
        failedCount: 2,
        metadataPendingCount: 6,
        metadataRetryableCount: 1,
        lastIndexWriteAt: new Date('2026-03-27T01:00:00.000Z'),
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

    await expect(service.getSyncStatus()).resolves.toEqual(
      expect.objectContaining({
        totals: expect.objectContaining({
          indexedScenes: 120,
          acquisitionTrackedScenes: 14,
          metadataBacklogScenes: 7,
          metadataHydration: {
            pending: 6,
            retryable: 1,
          },
        }),
        freshness: expect.objectContaining({
          requestRowsFresh: true,
          whisparrMoviesFresh: true,
          stashAvailabilityFresh: true,
          canResolveUnknownScenesAsNotRequested: true,
          acquisitionCountsSource: 'scene-index-summary',
          lastIndexWriteAt: '2026-03-27T01:00:00.000Z',
        }),
        jobs: expect.arrayContaining([
          expect.objectContaining({
            jobName: INDEXING_JOB_NAMES.WHISPARR_MOVIES,
            lastDurationMs: 1_500,
            processedCount: 40,
            updatedCount: 12,
            lastRunReason: 'interval',
          }),
        ]),
      }),
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

  it('skips scheduled metadata backfill when metadata was hydrated successfully but remains sparse', async () => {
    const { prisma } = createPrismaMock({
      sceneIndexRows: [
        buildSceneIndexRow({
          stashId: 'scene-1',
          title: null,
          imageUrl: null,
          studioName: null,
          metadataHydrationState: MetadataHydrationState.HYDRATED,
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
