import { BadRequestException } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { AcquisitionService } from './acquisition.service';

describe('AcquisitionService', () => {
  const findOneMock = jest.fn();
  const getQueueSnapshotMock = jest.fn();
  const getMovieSnapshotMock = jest.fn();
  const buildSceneViewUrlMock = jest.fn();
  const getSceneByIdMock = jest.fn();
  const getScenesBySortMock = jest.fn();
  const resolveForScenesWithEvidenceMock = jest.fn();
  const requestFindManyMock = jest.fn();

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const whisparrAdapter = {
    getQueueSnapshot: getQueueSnapshotMock,
    getMovieSnapshot: getMovieSnapshotMock,
    buildSceneViewUrl: buildSceneViewUrlMock,
  } as unknown as WhisparrAdapter;

  const stashdbAdapter = {
    getSceneById: getSceneByIdMock,
    getScenesBySort: getScenesBySortMock,
  } as unknown as StashdbAdapter;

  const sceneStatusService = {
    resolveForScenesWithEvidence: resolveForScenesWithEvidenceMock,
  } as unknown as SceneStatusService;

  const prismaService = {
    request: {
      findMany: requestFindManyMock,
    },
  } as unknown as PrismaService;

  const configuredWhisparrIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://whisparr.local',
    apiKey: 'wh-key',
  };

  const configuredStashdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stashdb.local',
    apiKey: 'stashdb-key',
  };

  let service: AcquisitionService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new AcquisitionService(
      integrationsService,
      whisparrAdapter,
      stashdbAdapter,
      sceneStatusService,
      prismaService,
    );

    findOneMock.mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.WHISPARR) {
        return configuredWhisparrIntegration;
      }

      if (type === IntegrationType.STASHDB) {
        return configuredStashdbIntegration;
      }

      throw new Error('Unexpected integration type');
    });

    buildSceneViewUrlMock.mockImplementation(
      (baseUrl: string, movieId: number) => `${baseUrl}/movie/${movieId}`,
    );
    getSceneByIdMock.mockImplementation((stashId: string) =>
      Promise.resolve({
        id: stashId,
        title: `Title ${stashId}`,
        details: `Description ${stashId}`,
        imageUrl: `http://image/${stashId}`,
        images: [],
        studioId: 'studio-1',
        studioName: 'Studio',
        studioImageUrl: 'http://studio/image',
        releaseDate: '2026-03-01',
        duration: 720,
        tags: [],
        performers: [],
        sourceUrls: [],
      }),
    );
  });

  function configureMixedLifecycleState(): void {
    requestFindManyMock.mockResolvedValue([
      {
        stashId: 'scene-requested',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-05T00:00:00.000Z'),
      },
      {
        stashId: 'scene-available',
        createdAt: new Date('2026-03-02T00:00:00.000Z'),
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
    ]);

    getQueueSnapshotMock.mockResolvedValue([
      {
        movieId: 20,
        status: 'downloading',
        trackedDownloadState: 'downloading',
        trackedDownloadStatus: 'ok',
        errorMessage: null,
      },
      {
        movieId: 40,
        status: 'failed',
        trackedDownloadState: 'warning',
        trackedDownloadStatus: 'warning',
        errorMessage: 'download failed',
      },
    ]);

    getMovieSnapshotMock.mockResolvedValue([
      { movieId: 20, stashId: 'scene-downloading', hasFile: false },
      { movieId: 30, stashId: 'scene-import', hasFile: true },
      { movieId: 40, stashId: 'scene-failed', hasFile: false },
      { movieId: 50, stashId: 'scene-available', hasFile: true },
      { movieId: 60, stashId: 'scene-not-requested', hasFile: false },
    ]);

    resolveForScenesWithEvidenceMock.mockResolvedValue(
      new Map([
        ['scene-downloading', { state: 'DOWNLOADING' }],
        ['scene-failed', { state: 'FAILED' }],
        ['scene-requested', { state: 'REQUESTED' }],
        ['scene-available', { state: 'AVAILABLE' }],
        ['scene-import', { state: 'IMPORT_PENDING' }],
        ['scene-not-requested', { state: 'NOT_REQUESTED' }],
      ]),
    );
  }

  it('builds the acquisition feed from local lifecycle evidence and excludes terminal states', async () => {
    configureMixedLifecycleState();

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
    expect(resolveForScenesWithEvidenceMock).toHaveBeenCalledWith(
      [
        'scene-downloading',
        'scene-failed',
        'scene-requested',
        'scene-available',
        'scene-import',
        'scene-not-requested',
      ],
      expect.objectContaining({
        queueItems: expect.any(Array),
        movieByStashId: expect.any(Map),
      }),
    );
    expect(getSceneByIdMock.mock.calls.map(([stashId]) => stashId)).toEqual([
      'scene-failed',
      'scene-downloading',
    ]);
    expect(getScenesBySortMock).not.toHaveBeenCalled();
  });

  it.each([
    ['REQUESTED', 'scene-requested'],
    ['DOWNLOADING', 'scene-downloading'],
    ['IMPORT_PENDING', 'scene-import'],
    ['FAILED', 'scene-failed'],
  ] as const)(
    'filters acquisition feed to %s scenes',
    async (lifecycle, expectedSceneId) => {
      configureMixedLifecycleState();

      const result = await service.getScenesFeed(1, 25, lifecycle);

      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.items.map((item) => item.id)).toEqual([expectedSceneId]);
    },
  );

  it('shows a newly requested scene from the local request table even before queue activity exists', async () => {
    requestFindManyMock.mockResolvedValue([
      {
        stashId: 'scene-new',
        createdAt: new Date('2026-03-12T00:00:00.000Z'),
        updatedAt: new Date('2026-03-12T00:00:00.000Z'),
      },
    ]);
    getQueueSnapshotMock.mockResolvedValue([]);
    getMovieSnapshotMock.mockResolvedValue([]);
    resolveForScenesWithEvidenceMock.mockResolvedValue(
      new Map([['scene-new', { state: 'REQUESTED' }]]),
    );

    const result = await service.getScenesFeed(1, 25, 'REQUESTED');

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(['scene-new']);
    expect(result.items[0]?.whisparrViewUrl).toBeNull();
  });

  it('throws when STASHDB integration has no baseUrl', async () => {
    findOneMock.mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.STASHDB) {
        return {
          ...configuredStashdbIntegration,
          baseUrl: '   ',
        };
      }
      return configuredWhisparrIntegration;
    });

    await expect(service.getScenesFeed()).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
