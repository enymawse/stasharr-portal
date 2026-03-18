import { IntegrationStatus, RequestStatus } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { SceneStatusService } from './scene-status.service';

describe('SceneStatusService', () => {
  const requestDelegate = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  };

  const prisma = {
    request: requestDelegate,
  } as unknown as PrismaService;

  const findOneMock = jest.fn();
  const findMovieByStashIdMock = jest.fn();
  const getQueueSnapshotMock = jest.fn();

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const whisparrAdapter = {
    findMovieByStashId: findMovieByStashIdMock,
    getQueueSnapshot: getQueueSnapshotMock,
  } as unknown as WhisparrAdapter;

  const configuredWhisparrIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://whisparr.local',
    apiKey: 'key',
  };

  let service: SceneStatusService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SceneStatusService(
      prisma,
      integrationsService,
      whisparrAdapter,
    );
  });

  describe('resolveForScene', () => {
    it('returns NOT_REQUESTED when id is empty', async () => {
      await expect(service.resolveForScene('  ')).resolves.toEqual({
        state: 'NOT_REQUESTED',
      });
      expect(requestDelegate.findUnique).not.toHaveBeenCalled();
      expect(findMovieByStashIdMock).not.toHaveBeenCalled();
      expect(getQueueSnapshotMock).not.toHaveBeenCalled();
    });

    it('keeps fallback status when Whisparr integration is missing', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.PROCESSING,
      });
      findOneMock.mockRejectedValue(new Error('missing integration'));

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'DOWNLOADING',
      });
      expect(findMovieByStashIdMock).not.toHaveBeenCalled();
      expect(getQueueSnapshotMock).not.toHaveBeenCalled();
    });

    it('returns NOT_REQUESTED when Whisparr has no movie match', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.PROCESSING,
      });
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findMovieByStashIdMock.mockResolvedValue(null);
      getQueueSnapshotMock.mockResolvedValue([]);

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'NOT_REQUESTED',
      });
    });

    it('returns DOWNLOADING when queue has in-flight state', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.FAILED,
      });
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findMovieByStashIdMock.mockResolvedValue({
        movieId: 100,
        stashId: 'scene-1',
        hasFile: false,
      });
      getQueueSnapshotMock.mockResolvedValue([
        {
          movieId: 100,
          trackedDownloadState: 'Importing',
          trackedDownloadStatus: 'Warning',
        },
      ]);

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'DOWNLOADING',
      });
    });

    it('returns AVAILABLE when hasFile=true and queue is not in-flight', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.REQUESTED,
      });
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findMovieByStashIdMock.mockResolvedValue({
        movieId: 100,
        stashId: 'scene-1',
        hasFile: true,
      });
      getQueueSnapshotMock.mockResolvedValue([
        {
          movieId: 100,
          trackedDownloadState: 'Imported',
          trackedDownloadStatus: 'Warning',
        },
      ]);

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'AVAILABLE',
      });
    });

    it('returns MISSING when hasFile=false and queue state is not in-flight', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.REQUESTED,
      });
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findMovieByStashIdMock.mockResolvedValue({
        movieId: 100,
        stashId: 'scene-1',
        hasFile: false,
      });
      getQueueSnapshotMock.mockResolvedValue([
        {
          movieId: 100,
          trackedDownloadState: 'Failed',
          trackedDownloadStatus: 'Error',
        },
      ]);

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'MISSING',
      });
    });

    it('keeps fallback status when Whisparr call fails', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.PROCESSING,
      });
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findMovieByStashIdMock.mockRejectedValue(new Error('provider failed'));
      getQueueSnapshotMock.mockResolvedValue([]);

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'DOWNLOADING',
      });
    });
  });

  describe('resolveForScenes', () => {
    it('returns empty map for no ids', async () => {
      await expect(service.resolveForScenes([])).resolves.toEqual(new Map());
      expect(requestDelegate.findMany).not.toHaveBeenCalled();
      expect(findMovieByStashIdMock).not.toHaveBeenCalled();
      expect(getQueueSnapshotMock).not.toHaveBeenCalled();
    });

    it('applies fallback statuses when Whisparr is unavailable', async () => {
      requestDelegate.findMany.mockResolvedValue([
        {
          stashId: 'scene-1',
          status: RequestStatus.REQUESTED,
        },
      ]);
      findOneMock.mockRejectedValue(new Error('missing integration'));

      const result = await service.resolveForScenes(['scene-1', 'scene-2']);

      expect(result.get('scene-1')).toEqual({ state: 'DOWNLOADING' });
      expect(result.get('scene-2')).toEqual({ state: 'NOT_REQUESTED' });
      expect(findMovieByStashIdMock).not.toHaveBeenCalled();
      expect(getQueueSnapshotMock).not.toHaveBeenCalled();
    });

    it('fetches queue once and resolves all scenes using movieId->queue join', async () => {
      requestDelegate.findMany.mockResolvedValue([
        {
          stashId: 'scene-1',
          status: RequestStatus.FAILED,
        },
        {
          stashId: 'scene-2',
          status: RequestStatus.PROCESSING,
        },
      ]);
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      getQueueSnapshotMock.mockResolvedValue([
        {
          movieId: 101,
          trackedDownloadState: 'Downloading',
          trackedDownloadStatus: 'Warning',
        },
      ]);
      findMovieByStashIdMock.mockImplementation((stashId: string) => {
        if (stashId === 'scene-1') {
          return { movieId: 101, stashId, hasFile: false };
        }
        if (stashId === 'scene-2') {
          return { movieId: 102, stashId, hasFile: true };
        }
        return null;
      });

      const result = await service.resolveForScenes([
        'scene-1',
        ' scene-2 ',
        'scene-3',
      ]);

      expect(getQueueSnapshotMock).toHaveBeenCalledTimes(1);
      expect(result.get('scene-1')).toEqual({ state: 'DOWNLOADING' });
      expect(result.get('scene-2')).toEqual({ state: 'AVAILABLE' });
      expect(result.get('scene-3')).toEqual({ state: 'NOT_REQUESTED' });
    });

    it('keeps per-scene fallback status when movie lookup fails for one item', async () => {
      requestDelegate.findMany.mockResolvedValue([
        {
          stashId: 'scene-1',
          status: RequestStatus.PROCESSING,
        },
        {
          stashId: 'scene-2',
          status: RequestStatus.FAILED,
        },
      ]);
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      getQueueSnapshotMock.mockResolvedValue([]);
      findMovieByStashIdMock.mockImplementation((stashId: string) => {
        if (stashId === 'scene-1') {
          throw new Error('provider failed');
        }
        return { movieId: 200, stashId, hasFile: false };
      });

      const result = await service.resolveForScenes(['scene-1', 'scene-2']);

      expect(result.get('scene-1')).toEqual({ state: 'DOWNLOADING' });
      expect(result.get('scene-2')).toEqual({ state: 'MISSING' });
    });

    it('keeps fallback statuses when queue snapshot fetch fails', async () => {
      requestDelegate.findMany.mockResolvedValue([
        {
          stashId: 'scene-1',
          status: RequestStatus.FAILED,
        },
      ]);
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      getQueueSnapshotMock.mockRejectedValue(new Error('provider failed'));

      const result = await service.resolveForScenes(['scene-1']);

      expect(result.get('scene-1')).toEqual({ state: 'MISSING' });
      expect(findMovieByStashIdMock).not.toHaveBeenCalled();
    });
  });
});
