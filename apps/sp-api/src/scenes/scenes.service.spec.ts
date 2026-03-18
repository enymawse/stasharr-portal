import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import {
  StashdbAdapter,
  StashdbSceneDetails,
} from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { ScenesService } from './scenes.service';

describe('ScenesService', () => {
  const integrationsService = {
    findOne: jest.fn(),
  } as unknown as IntegrationsService;

  const stashdbAdapter = {
    getSceneById: jest.fn(),
    getScenesSortedByDate: jest.fn(),
  } as unknown as StashdbAdapter;

  const sceneStatusService = {
    resolveForScene: jest.fn(),
  } as unknown as SceneStatusService;

  const stashAdapter = {
    findScenesByStashId: jest.fn(),
  } as unknown as StashAdapter;

  const whisparrAdapter = {
    findMovieByStashId: jest.fn(),
    buildSceneViewUrl: jest.fn(),
  } as unknown as WhisparrAdapter;

  const stashdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stashdb.local',
    apiKey: 'stashdb-key',
  };

  const stashIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stash.local',
    apiKey: 'stash-key',
  };

  const whisparrIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://whisparr.local',
    apiKey: 'whisparr-key',
  };

  const sceneDetails: StashdbSceneDetails = {
    id: 'stashdb-scene-1',
    title: 'Scene',
    details: 'Description',
    imageUrl: 'http://image',
    images: [],
    studioName: 'Studio',
    studioImageUrl: 'http://studio-image',
    releaseDate: '2026-01-01',
    duration: 300,
    tags: [],
    performers: [],
    sourceUrls: [],
  };

  let service: ScenesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ScenesService(
      integrationsService,
      stashdbAdapter,
      sceneStatusService,
      stashAdapter,
      whisparrAdapter,
    );

    integrationsService.findOne = jest
      .fn()
      .mockImplementation((type: IntegrationType) => {
        if (type === IntegrationType.STASHDB) {
          return stashdbIntegration;
        }

        if (type === IntegrationType.STASH) {
          return stashIntegration;
        }

        if (type === IntegrationType.WHISPARR) {
          return whisparrIntegration;
        }

        throw new Error('Unexpected integration type');
      });

    stashdbAdapter.getSceneById = jest.fn().mockResolvedValue(sceneDetails);
    stashdbAdapter.getScenesSortedByDate = jest.fn().mockResolvedValue({
      total: 1,
      scenes: [
        {
          id: 'stashdb-scene-1',
          title: 'Scene',
          details: 'Description',
          imageUrl: 'http://image',
          studioName: 'Studio',
          studioImageUrl: 'http://studio-image',
          date: '2026-01-01',
          releaseDate: '2026-01-02',
          productionDate: '2026-01-03',
          duration: 300,
        },
      ],
    });
    sceneStatusService.resolveForScene = jest
      .fn()
      .mockResolvedValue({ state: 'AVAILABLE' });
    sceneStatusService.resolveForScenes = jest
      .fn()
      .mockResolvedValue(
        new Map([['stashdb-scene-1', { state: 'AVAILABLE' }]]),
      );
    stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue([]);
    whisparrAdapter.findMovieByStashId = jest.fn().mockResolvedValue(null);
    whisparrAdapter.buildSceneViewUrl = jest
      .fn()
      .mockReturnValue('http://whisparr.local/movie/stashdb-scene-1');
  });

  it('enriches scene details with stash availability when stash copies exist', async () => {
    stashAdapter.findScenesByStashId = jest.fn().mockResolvedValue([
      {
        id: '3027',
        width: 3840,
        height: 2160,
        viewUrl: 'http://stash.local/scene/3027',
        label: '2160p',
      },
      {
        id: '3030',
        width: 1920,
        height: 1080,
        viewUrl: 'http://stash.local/scene/3030',
        label: '1080p',
      },
    ]);

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      stash: {
        exists: true,
        hasMultipleCopies: true,
        copies: [
          { id: '3027', label: '2160p' },
          { id: '3030', label: '1080p' },
        ],
      },
      whisparr: null,
    });
  });

  it('returns a date-sorted scenes feed with scene statuses', async () => {
    await expect(service.getScenesFeed(1, 25)).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 25,
      hasMore: false,
      items: [
        {
          id: 'stashdb-scene-1',
          title: 'Scene',
          description: 'Description',
          imageUrl: 'http://image',
          studio: 'Studio',
          studioImageUrl: 'http://studio-image',
          releaseDate: '2026-01-02',
          duration: 300,
          type: 'SCENE',
          source: 'STASHDB',
          status: { state: 'AVAILABLE' },
        },
      ],
    });
  });

  it('returns stash null when stash integration is unavailable', async () => {
    integrationsService.findOne = jest
      .fn()
      .mockImplementation((type: IntegrationType) => {
        if (type === IntegrationType.STASHDB) {
          return stashdbIntegration;
        }

        throw new Error('stash unavailable');
      });

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      stash: null,
      whisparr: null,
    });
  });

  it('returns stash null when stash provider fails', async () => {
    stashAdapter.findScenesByStashId = jest
      .fn()
      .mockRejectedValue(new Error('provider failed'));

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      stash: null,
      whisparr: null,
    });
  });

  it('enriches scene details with whisparr view link when scene exists in whisparr', async () => {
    whisparrAdapter.findMovieByStashId = jest.fn().mockResolvedValue({
      movieId: 44,
      stashId: 'stashdb-scene-1',
      hasFile: false,
    });

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      whisparr: {
        exists: true,
        viewUrl: 'http://whisparr.local/movie/stashdb-scene-1',
      },
    });
  });

  it('returns whisparr null when whisparr provider fails', async () => {
    whisparrAdapter.findMovieByStashId = jest
      .fn()
      .mockRejectedValue(new Error('provider failed'));

    await expect(
      service.getSceneById('stashdb-scene-1'),
    ).resolves.toMatchObject({
      id: 'stashdb-scene-1',
      whisparr: null,
    });
  });
});
