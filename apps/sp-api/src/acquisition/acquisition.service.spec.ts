import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IndexingService } from '../indexing/indexing.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { AcquisitionService } from './acquisition.service';

function buildIndexedRow(overrides: Record<string, unknown> = {}) {
  return {
    stashId: 'scene-1',
    requestStatus: null,
    requestUpdatedAt: new Date('2026-03-10T00:00:00.000Z'),
    title: 'Title scene-1',
    description: 'Description scene-1',
    imageUrl: 'http://image/scene-1',
    studioId: 'studio-1',
    studioName: 'Studio',
    studioImageUrl: 'http://studio/image',
    releaseDate: '2026-03-01',
    duration: 720,
    whisparrMovieId: 44,
    whisparrHasFile: false,
    whisparrQueuePosition: 0,
    whisparrQueueStatus: 'downloading',
    whisparrQueueState: 'downloading',
    whisparrErrorMessage: null,
    stashAvailable: false,
    computedLifecycle: 'DOWNLOADING',
    lifecycleSortOrder: 1,
    metadataLastSyncedAt: new Date('2026-03-10T00:00:00.000Z'),
    whisparrLastSyncedAt: new Date('2026-03-10T00:00:00.000Z'),
    stashLastSyncedAt: new Date('2026-03-10T00:00:00.000Z'),
    lastSyncedAt: new Date('2026-03-10T00:00:00.000Z'),
    createdAt: new Date('2026-03-10T00:00:00.000Z'),
    updatedAt: new Date('2026-03-10T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AcquisitionService', () => {
  const findOneMock = jest.fn();
  const buildSceneViewUrlMock = jest.fn();
  const requestMetadataHydrationForStashIdsMock = jest.fn();
  const toSceneStatusMock = jest.fn();
  const sceneIndexFindManyMock = jest.fn();
  const sceneIndexCountMock = jest.fn();
  const transactionMock = jest.fn();

  const indexingService = {
    requestMetadataHydrationForStashIds: requestMetadataHydrationForStashIdsMock,
    toSceneStatus: toSceneStatusMock,
  } as unknown as IndexingService;

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const whisparrAdapter = {
    buildSceneViewUrl: buildSceneViewUrlMock,
  } as unknown as WhisparrAdapter;

  const prismaService = {
    sceneIndex: {
      findMany: sceneIndexFindManyMock,
      count: sceneIndexCountMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const configuredWhisparrIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://whisparr.local',
    apiKey: 'wh-key',
  };

  let service: AcquisitionService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new AcquisitionService(
      indexingService,
      integrationsService,
      whisparrAdapter,
      prismaService,
    );

    buildSceneViewUrlMock.mockImplementation(
      (baseUrl: string, movieId: number) => `${baseUrl}/movie/${movieId}`,
    );
    toSceneStatusMock.mockImplementation((row: { computedLifecycle: string }) => ({
      state: row.computedLifecycle,
    }));
    transactionMock.mockImplementation((operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    );
    findOneMock.mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.WHISPARR) {
        return configuredWhisparrIntegration;
      }

      throw new Error(`Unexpected integration type: ${type}`);
    });

    sceneIndexCountMock.mockImplementation(
      (args?: { where?: { computedLifecycle?: unknown } }) => {
        const lifecycle = args?.where?.computedLifecycle;
        if (!lifecycle) {
          return Promise.resolve(4);
        }

        if (typeof lifecycle === 'string') {
          return Promise.resolve(
            lifecycle === 'REQUESTED' ||
              lifecycle === 'DOWNLOADING' ||
              lifecycle === 'IMPORT_PENDING' ||
              lifecycle === 'FAILED'
              ? 1
              : 0,
          );
        }

        if (
          lifecycle &&
          typeof lifecycle === 'object' &&
          Array.isArray((lifecycle as { in?: unknown[] }).in)
        ) {
          return Promise.resolve(4);
        }

        return Promise.resolve(0);
      },
    );

    sceneIndexFindManyMock.mockResolvedValue([
      buildIndexedRow({
        stashId: 'scene-failed',
        title: 'Title scene-failed',
        computedLifecycle: 'FAILED',
        lifecycleSortOrder: 0,
        whisparrMovieId: 40,
        whisparrQueueStatus: 'failed',
        whisparrQueueState: 'warning',
      }),
      buildIndexedRow({
        stashId: 'scene-downloading',
        title: 'Title scene-downloading',
        computedLifecycle: 'DOWNLOADING',
        lifecycleSortOrder: 1,
        whisparrMovieId: 20,
      }),
    ]);
  });

  it('builds the acquisition feed from the local scene index', async () => {
    const result = await service.getScenesFeed(1, 2);

    expect(result.total).toBe(4);
    expect(result.hasMore).toBe(true);
    expect(result.countsByLifecycle).toEqual({
      REQUESTED: 1,
      DOWNLOADING: 1,
      IMPORT_PENDING: 1,
      FAILED: 1,
    });
    expect(result.items.map((item) => item.id)).toEqual([
      'scene-failed',
      'scene-downloading',
    ]);
    expect(result.items[0]?.whisparrViewUrl).toBe(
      'http://whisparr.local/movie/40',
    );
    expect(sceneIndexFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          computedLifecycle: {
            in: ['REQUESTED', 'DOWNLOADING', 'IMPORT_PENDING', 'FAILED'],
          },
        },
        skip: 0,
        take: 2,
      }),
    );
    expect(requestMetadataHydrationForStashIdsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['REQUESTED', 1],
    ['DOWNLOADING', 1],
    ['IMPORT_PENDING', 1],
    ['FAILED', 1],
  ] as const)(
    'filters acquisition feed to %s scenes in the database query',
    async (lifecycle, expectedTotal) => {
      sceneIndexFindManyMock.mockResolvedValue([
        buildIndexedRow({
          stashId: `scene-${lifecycle.toLowerCase()}`,
          computedLifecycle: lifecycle,
        }),
      ]);
      sceneIndexCountMock.mockImplementation(
        (args?: { where?: { computedLifecycle?: unknown } }) => {
          const filter = args?.where?.computedLifecycle;
          if (filter === lifecycle) {
            return Promise.resolve(expectedTotal);
          }

          if (
            filter &&
            typeof filter === 'object' &&
            Array.isArray((filter as { in?: unknown[] }).in)
          ) {
            return Promise.resolve(4);
          }

          return Promise.resolve(1);
        },
      );

      const result = await service.getScenesFeed(1, 25, lifecycle);

      expect(result.total).toBe(expectedTotal);
      expect(sceneIndexFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            computedLifecycle: lifecycle,
          },
        }),
      );
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.status).toEqual({ state: lifecycle });
    },
  );

  it('schedules metadata hydration only for the requested page window', async () => {
    sceneIndexFindManyMock.mockResolvedValue([
      buildIndexedRow({
        stashId: 'scene-missing-metadata',
        title: null,
        metadataLastSyncedAt: null,
        computedLifecycle: 'REQUESTED',
        whisparrMovieId: 99,
      }),
    ]);
    sceneIndexCountMock.mockImplementation(
      (args?: { where?: { computedLifecycle?: unknown } }) => {
        const filter = args?.where?.computedLifecycle;
        if (filter === 'REQUESTED') {
          return Promise.resolve(1);
        }
        if (
          filter &&
          typeof filter === 'object' &&
          Array.isArray((filter as { in?: unknown[] }).in)
        ) {
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      },
    );

    const result = await service.getScenesFeed(1, 25, 'REQUESTED');

    expect(requestMetadataHydrationForStashIdsMock).toHaveBeenCalledWith(
      ['scene-missing-metadata'],
      'acquisition-page',
    );
    expect(result.items[0]?.title).toBe('scene-missing-metadata');
  });
});
