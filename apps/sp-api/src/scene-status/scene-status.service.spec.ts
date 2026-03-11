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
  const findSceneByStashIdMock = jest.fn();

  const integrationsService = {
    findOne: findOneMock,
  } as unknown as IntegrationsService;

  const whisparrAdapter = {
    findSceneByStashId: findSceneByStashIdMock,
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
    it('returns UNREQUESTED when id is empty', async () => {
      await expect(service.resolveForScene('  ')).resolves.toEqual({
        state: 'UNREQUESTED',
      });
      expect(requestDelegate.findUnique).not.toHaveBeenCalled();
      expect(findSceneByStashIdMock).not.toHaveBeenCalled();
    });

    it('keeps fallback status when Whisparr integration is missing', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.PROCESSING,
      });
      findOneMock.mockRejectedValue(new Error('missing integration'));

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'PROCESSING',
      });
      expect(findSceneByStashIdMock).not.toHaveBeenCalled();
    });

    it('keeps fallback status when Whisparr returns no match', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.PROCESSING,
      });
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findSceneByStashIdMock.mockResolvedValue(null);

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'PROCESSING',
      });
    });

    it('resolves AVAILABLE when Whisparr returns matching available scene', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.REQUESTED,
      });
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findSceneByStashIdMock.mockResolvedValue({
        stashId: 'scene-1',
        available: true,
      });

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'AVAILABLE',
      });
    });

    it('resolves REQUESTED when Whisparr returns matching scene without file', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.FAILED,
      });
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findSceneByStashIdMock.mockResolvedValue({
        stashId: 'scene-1',
        available: false,
      });

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'REQUESTED',
      });
    });

    it('keeps fallback status when Whisparr is disabled', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.PROCESSING,
      });
      findOneMock.mockResolvedValue({
        ...configuredWhisparrIntegration,
        enabled: false,
      });

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'PROCESSING',
      });
      expect(findSceneByStashIdMock).not.toHaveBeenCalled();
    });

    it('keeps fallback status when Whisparr call fails', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.PROCESSING,
      });
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findSceneByStashIdMock.mockRejectedValue(new Error('provider failed'));

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'PROCESSING',
      });
    });
  });

  describe('resolveForScenes', () => {
    it('returns empty map for no ids', async () => {
      await expect(service.resolveForScenes([])).resolves.toEqual(new Map());
      expect(requestDelegate.findMany).not.toHaveBeenCalled();
      expect(findSceneByStashIdMock).not.toHaveBeenCalled();
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

      expect(result.get('scene-1')).toEqual({ state: 'REQUESTED' });
      expect(result.get('scene-2')).toEqual({ state: 'UNREQUESTED' });
      expect(findSceneByStashIdMock).not.toHaveBeenCalled();
    });

    it('overrides fallback statuses from Whisparr matches', async () => {
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
      findSceneByStashIdMock.mockImplementation((stashId: string) => {
        if (stashId === 'scene-1') {
          return { stashId, available: true };
        }
        if (stashId === 'scene-2') {
          return { stashId, available: false };
        }
        return null;
      });

      const result = await service.resolveForScenes([
        'scene-1',
        ' scene-2 ',
        'scene-3',
      ]);

      expect(result.get('scene-1')).toEqual({ state: 'AVAILABLE' });
      expect(result.get('scene-2')).toEqual({ state: 'REQUESTED' });
      expect(result.get('scene-3')).toEqual({ state: 'UNREQUESTED' });
    });

    it('keeps fallback status when individual Whisparr lookups fail', async () => {
      requestDelegate.findMany.mockResolvedValue([
        {
          stashId: 'scene-1',
          status: RequestStatus.PROCESSING,
        },
      ]);
      findOneMock.mockResolvedValue(configuredWhisparrIntegration);
      findSceneByStashIdMock.mockRejectedValue(new Error('provider failed'));

      const result = await service.resolveForScenes(['scene-1']);

      expect(result.get('scene-1')).toEqual({ state: 'PROCESSING' });
    });
  });
});
