import {
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { RequestsService } from './requests.service';

describe('RequestsService', () => {
  const findOneMock = jest.fn();
  const getQueueSnapshotMock = jest.fn();
  const findMovieByIdMock = jest.fn();
  const getSceneByIdMock = jest.fn();
  const resolveForScenesMock = jest.fn();

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const whisparrAdapter = {
    getQueueSnapshot: getQueueSnapshotMock,
    findMovieById: findMovieByIdMock,
  } as unknown as WhisparrAdapter;

  const stashdbAdapter = {
    getSceneById: getSceneByIdMock,
  } as unknown as StashdbAdapter;

  const sceneStatusService = {
    resolveForScenes: resolveForScenesMock,
  } as unknown as SceneStatusService;

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

  let service: RequestsService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new RequestsService(
      integrationsService,
      whisparrAdapter,
      stashdbAdapter,
      sceneStatusService,
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

    resolveForScenesMock.mockResolvedValue(new Map());
    getSceneByIdMock.mockImplementation((stashId: string) =>
      Promise.resolve({
        id: stashId,
        title: `Title ${stashId}`,
        details: `Description ${stashId}`,
        imageUrl: `http://image/${stashId}`,
        images: [],
        studioName: 'Studio',
        studioImageUrl: 'http://studio/image',
        releaseDate: '2026-01-01',
        duration: 123,
        tags: [],
        performers: [],
        sourceUrls: [],
      }),
    );
  });

  it('builds queue-scoped feed with stable deduped order and pagination', async () => {
    getQueueSnapshotMock.mockResolvedValue([
      { movieId: 2, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
      { movieId: 1, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
      { movieId: 2, trackedDownloadState: 'importing', trackedDownloadStatus: 'ok' },
      { movieId: 3, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
    ]);

    findMovieByIdMock.mockImplementation((movieId: number) => {
      if (movieId === 1) {
        return { movieId, stashId: 'scene-a', hasFile: false };
      }
      if (movieId === 2) {
        return { movieId, stashId: 'scene-b', hasFile: false };
      }
      if (movieId === 3) {
        return { movieId, stashId: 'scene-c', hasFile: false };
      }
      return null;
    });

    resolveForScenesMock.mockResolvedValue(
      new Map([
        ['scene-b', { state: 'DOWNLOADING' }],
        ['scene-a', { state: 'MISSING' }],
      ]),
    );

    const result = await service.getRequestsFeed(1, 2);

    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.perPage).toBe(2);
    expect(result.hasMore).toBe(true);
    expect(result.items.map((item) => item.id)).toEqual(['scene-b', 'scene-a']);
    expect(resolveForScenesMock).toHaveBeenCalledWith(['scene-b', 'scene-a']);
    expect(findMovieByIdMock).toHaveBeenCalledTimes(3);
    expect(getSceneByIdMock).toHaveBeenCalledTimes(2);
  });

  it('returns next page slice from queue-scoped ids', async () => {
    getQueueSnapshotMock.mockResolvedValue([
      { movieId: 1, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
      { movieId: 2, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
      { movieId: 3, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
    ]);

    findMovieByIdMock.mockImplementation((movieId: number) => ({
      movieId,
      stashId: `scene-${movieId}`,
      hasFile: false,
    }));

    resolveForScenesMock.mockResolvedValue(
      new Map([['scene-3', { state: 'DOWNLOADING' }]]),
    );

    const result = await service.getRequestsFeed(2, 2);

    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(false);
    expect(result.items.map((item) => item.id)).toEqual(['scene-3']);
    expect(resolveForScenesMock).toHaveBeenCalledWith(['scene-3']);
  });

  it('skips unmappable queue items and logs warnings', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    getQueueSnapshotMock.mockResolvedValue([
      { movieId: 1, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
      { movieId: 2, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
      { movieId: 3, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
    ]);

    findMovieByIdMock.mockImplementation((movieId: number) => {
      if (movieId === 1) {
        return null;
      }
      if (movieId === 2) {
        throw new Error('lookup failed');
      }
      return { movieId, stashId: 'scene-3', hasFile: false };
    });

    resolveForScenesMock.mockResolvedValue(
      new Map([['scene-3', { state: 'DOWNLOADING' }]]),
    );

    const result = await service.getRequestsFeed(1, 25);

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(['scene-3']);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('skips scene enrichment failures without failing the full feed', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    getQueueSnapshotMock.mockResolvedValue([
      { movieId: 1, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
      { movieId: 2, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
    ]);

    findMovieByIdMock.mockImplementation((movieId: number) => ({
      movieId,
      stashId: `scene-${movieId}`,
      hasFile: false,
    }));

    getSceneByIdMock.mockImplementation((stashId: string) => {
      if (stashId === 'scene-1') {
        throw new Error('stashdb lookup failed');
      }

      return {
        id: stashId,
        title: 'Scene 2',
        details: 'Description',
        imageUrl: 'http://image',
        images: [],
        studioName: 'Studio',
        studioImageUrl: null,
        releaseDate: null,
        duration: null,
        tags: [],
        performers: [],
        sourceUrls: [],
      };
    });

    resolveForScenesMock.mockResolvedValue(
      new Map([
        ['scene-1', { state: 'MISSING' }],
        ['scene-2', { state: 'DOWNLOADING' }],
      ]),
    );

    const result = await service.getRequestsFeed(1, 25);

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(['scene-2']);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('throws when WHISPARR integration is disabled', async () => {
    findOneMock.mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.WHISPARR) {
        return {
          ...configuredWhisparrIntegration,
          enabled: false,
        };
      }
      return configuredStashdbIntegration;
    });

    await expect(service.getRequestsFeed()).rejects.toBeInstanceOf(
      ConflictException,
    );
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

    await expect(service.getRequestsFeed()).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
