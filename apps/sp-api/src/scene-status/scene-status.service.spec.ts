import { RequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SceneStatusService } from './scene-status.service';

describe('SceneStatusService', () => {
  const requestDelegate = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  };

  const prisma = {
    request: requestDelegate,
  } as unknown as PrismaService;

  let service: SceneStatusService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SceneStatusService(prisma);
  });

  describe('resolveForScene', () => {
    it('returns UNREQUESTED when id is empty', async () => {
      await expect(service.resolveForScene('  ')).resolves.toEqual({
        state: 'UNREQUESTED',
      });
      expect(requestDelegate.findUnique).not.toHaveBeenCalled();
    });

    it('returns mapped request status when request exists', async () => {
      requestDelegate.findUnique.mockResolvedValue({
        status: RequestStatus.PROCESSING,
      });

      await expect(service.resolveForScene('scene-1')).resolves.toEqual({
        state: 'PROCESSING',
      });
    });

    it('returns UNREQUESTED when request does not exist', async () => {
      requestDelegate.findUnique.mockResolvedValue(null);

      await expect(service.resolveForScene('scene-2')).resolves.toEqual({
        state: 'UNREQUESTED',
      });
    });
  });

  describe('resolveForScenes', () => {
    it('returns empty map for no ids', async () => {
      await expect(service.resolveForScenes([])).resolves.toEqual(new Map());
      expect(requestDelegate.findMany).not.toHaveBeenCalled();
    });

    it('resolves statuses in batch and defaults missing ids to UNREQUESTED', async () => {
      requestDelegate.findMany.mockResolvedValue([
        {
          stashId: 'scene-1',
          status: RequestStatus.REQUESTED,
        },
        {
          stashId: 'scene-3',
          status: RequestStatus.FAILED,
        },
      ]);

      const result = await service.resolveForScenes([
        'scene-1',
        ' scene-2 ',
        'scene-3',
        'scene-1',
      ]);

      expect(requestDelegate.findMany).toHaveBeenCalledWith({
        where: {
          stashId: {
            in: ['scene-1', 'scene-2', 'scene-3'],
          },
        },
        select: {
          stashId: true,
          status: true,
        },
      });

      expect(result.get('scene-1')).toEqual({ state: 'REQUESTED' });
      expect(result.get('scene-2')).toEqual({ state: 'UNREQUESTED' });
      expect(result.get('scene-3')).toEqual({ state: 'FAILED' });
    });
  });
});
