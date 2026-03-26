import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
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
  const findScenesByStashIdMock = jest.fn();

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const stashAdapter = {
    findScenesByStashId: findScenesByStashIdMock,
  } as unknown as StashAdapter;

  const whisparrAdapter = {
    findMovieByStashId: findMovieByStashIdMock,
    getQueueSnapshot: getQueueSnapshotMock,
  } as unknown as WhisparrAdapter;

  const configuredWhisparrIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://whisparr.local',
    apiKey: 'whisparr-key',
  };

  const configuredStashIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stash.local',
    apiKey: 'stash-key',
  };

  let service: SceneStatusService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SceneStatusService(
      prisma,
      integrationsService,
      stashAdapter,
      whisparrAdapter,
    );

    findOneMock.mockImplementation((type: IntegrationType) => {
      if (type === IntegrationType.WHISPARR) {
        return Promise.resolve(configuredWhisparrIntegration);
      }

      if (type === IntegrationType.STASH) {
        return Promise.resolve(configuredStashIntegration);
      }

      return Promise.reject(new Error(`Unexpected integration type: ${type}`));
    });
    requestDelegate.findUnique.mockResolvedValue(null);
    requestDelegate.findMany.mockResolvedValue([]);
    findScenesByStashIdMock.mockResolvedValue([]);
    findMovieByStashIdMock.mockResolvedValue(null);
    getQueueSnapshotMock.mockResolvedValue([]);
  });

  describe('resolveForScene', () => {
    it('returns NOT_REQUESTED when id is empty', async () => {
      await expect(service.resolveForScene('  ')).resolves.toEqual({
        state: 'NOT_REQUESTED',
      });
      expect(requestDelegate.findUnique).not.toHaveBeenCalled();
      expect(findScenesByStashIdMock).not.toHaveBeenCalled();
      expect(findMovieByStashIdMock).not.toHaveBeenCalled();
    });

    it('returns NOT_REQUESTED when no request, no Whisparr movie, and no Stash copy exist', async () => {
      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'NOT_REQUESTED',
      });
    });

    it('returns REQUESTED when a fallback Request row exists without Whisparr evidence yet', async () => {
      requestDelegate.findUnique.mockResolvedValue({ id: 'req-1' });

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'REQUESTED',
      });
    });

    it('returns REQUESTED when Whisparr knows the scene but acquisition has not started', async () => {
      findMovieByStashIdMock.mockResolvedValue({
        movieId: 101,
        stashId: 'scene-1',
        hasFile: false,
      });

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'REQUESTED',
      });
    });

    it('returns DOWNLOADING for an active Whisparr download queue item', async () => {
      findMovieByStashIdMock.mockResolvedValue({
        movieId: 101,
        stashId: 'scene-1',
        hasFile: false,
      });
      getQueueSnapshotMock.mockResolvedValue([
        {
          movieId: 101,
          trackedDownloadState: 'Downloading',
          trackedDownloadStatus: 'Ok',
        },
      ]);

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'DOWNLOADING',
      });
    });

    it('returns IMPORT_PENDING when Whisparr has the file but Stash does not', async () => {
      findMovieByStashIdMock.mockResolvedValue({
        movieId: 101,
        stashId: 'scene-1',
        hasFile: true,
      });

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'IMPORT_PENDING',
      });
    });

    it('returns AVAILABLE when Stash has a linked scene copy', async () => {
      findScenesByStashIdMock.mockResolvedValue([
        {
          id: 'local-1',
          width: 1920,
          height: 1080,
          viewUrl: 'http://stash.local/scenes/local-1',
          label: '1080p',
        },
      ]);

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'AVAILABLE',
      });
      expect(findMovieByStashIdMock).not.toHaveBeenCalled();
      expect(getQueueSnapshotMock).not.toHaveBeenCalled();
    });
  });

  describe('resolveForScenes', () => {
    it('returns empty map for no ids', async () => {
      await expect(service.resolveForScenes([])).resolves.toEqual(new Map());
      expect(requestDelegate.findMany).not.toHaveBeenCalled();
      expect(findScenesByStashIdMock).not.toHaveBeenCalled();
      expect(findMovieByStashIdMock).not.toHaveBeenCalled();
    });

    it('applies lifecycle precedence across fallback rows, Whisparr, and Stash', async () => {
      requestDelegate.findMany.mockResolvedValue([{ stashId: 'scene-1' }]);
      findScenesByStashIdMock.mockImplementation((stashId: string) =>
        Promise.resolve(
          stashId === 'scene-4'
            ? [
                {
                  id: 'local-4',
                  width: 1920,
                  height: 1080,
                  viewUrl: 'http://stash.local/scenes/local-4',
                  label: '1080p',
                },
              ]
            : [],
        ),
      );
      getQueueSnapshotMock.mockResolvedValue([
        {
          movieId: 102,
          trackedDownloadState: 'Downloading',
          trackedDownloadStatus: 'Ok',
        },
      ]);
      findMovieByStashIdMock.mockImplementation((stashId: string) => {
        if (stashId === 'scene-2') {
          return Promise.resolve({
            movieId: 102,
            stashId,
            hasFile: false,
          });
        }

        if (stashId === 'scene-3') {
          return Promise.resolve({
            movieId: 103,
            stashId,
            hasFile: true,
          });
        }

        if (stashId === 'scene-5') {
          return Promise.resolve(null);
        }

        return Promise.resolve(null);
      });

      const result = await service.resolveForScenes([
        'scene-1',
        'scene-2',
        'scene-3',
        'scene-4',
        'scene-5',
      ]);

      expect(getQueueSnapshotMock).toHaveBeenCalledTimes(1);
      expect(findMovieByStashIdMock).toHaveBeenCalledTimes(4);
      expect(findMovieByStashIdMock).not.toHaveBeenCalledWith(
        'scene-4',
        configuredWhisparrIntegration,
      );
      expect(result.get('scene-1')).toEqual({ state: 'REQUESTED' });
      expect(result.get('scene-2')).toEqual({ state: 'DOWNLOADING' });
      expect(result.get('scene-3')).toEqual({ state: 'IMPORT_PENDING' });
      expect(result.get('scene-4')).toEqual({ state: 'AVAILABLE' });
      expect(result.get('scene-5')).toEqual({ state: 'NOT_REQUESTED' });
    });

    it('keeps fallback-plus-stash resolution when Whisparr queue fetch fails', async () => {
      requestDelegate.findMany.mockResolvedValue([{ stashId: 'scene-1' }]);
      getQueueSnapshotMock.mockRejectedValue(new Error('provider failed'));

      const result = await service.resolveForScenes(['scene-1', 'scene-2']);

      expect(result.get('scene-1')).toEqual({ state: 'REQUESTED' });
      expect(result.get('scene-2')).toEqual({ state: 'NOT_REQUESTED' });
      expect(findMovieByStashIdMock).not.toHaveBeenCalled();
    });
  });
});
