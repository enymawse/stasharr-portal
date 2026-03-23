import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { PerformersService } from './performers.service';

describe('PerformersService', () => {
  const integrationsService = {
    findOne: jest.fn(),
  } as unknown as IntegrationsService;

  const stashdbAdapter = {
    getPerformersFeed: jest.fn(),
    getPerformerById: jest.fn(),
    getScenesForPerformer: jest.fn(),
    searchStudios: jest.fn(),
    favoritePerformer: jest.fn(),
  } as unknown as StashdbAdapter;

  const sceneStatusService = {
    resolveForScenes: jest.fn(),
  } as unknown as SceneStatusService;

  const stashdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stashdb.local/graphql',
    apiKey: 'stashdb-key',
  };

  let service: PerformersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PerformersService(
      integrationsService,
      stashdbAdapter,
      sceneStatusService,
    );

    integrationsService.findOne = jest
      .fn()
      .mockImplementation((type: IntegrationType) => {
        if (type === IntegrationType.STASHDB) {
          return stashdbIntegration;
        }

        throw new Error('Unexpected integration type');
      });

    stashdbAdapter.getPerformersFeed = jest.fn().mockResolvedValue({
      total: 1,
      performers: [
        {
          id: 'p-1',
          name: 'Performer One',
          gender: 'FEMALE',
          sceneCount: 12,
          isFavorite: true,
          imageUrl: null,
        },
      ],
    });
    stashdbAdapter.getPerformerById = jest.fn().mockResolvedValue({
      id: 'p-1',
      name: 'Performer One',
      disambiguation: null,
      aliases: ['Alias'],
      gender: 'FEMALE',
      birthDate: '1990-01-01',
      deathDate: null,
      age: 35,
      ethnicity: 'Ethnicity',
      country: 'US',
      eyeColor: 'Brown',
      hairColor: 'Black',
      height: '170cm',
      cupSize: null,
      bandSize: null,
      waistSize: null,
      hipSize: null,
      breastType: null,
      careerStartYear: 2010,
      careerEndYear: null,
      deleted: false,
      mergedIds: [],
      mergedIntoId: null,
      isFavorite: true,
      createdAt: '2024-01-01',
      updatedAt: '2025-01-01',
      imageUrl: null,
      images: [],
    });
    stashdbAdapter.getScenesForPerformer = jest.fn().mockResolvedValue({
      total: 1,
      scenes: [
        {
          id: 'scene-1',
          title: 'Scene One',
          details: 'Details',
          imageUrl: 'http://image',
          studioId: 'studio-1',
          studioName: 'Studio',
          studioImageUrl: 'http://studio-image',
          date: '2026-03-01',
          releaseDate: '2026-03-02',
          productionDate: null,
          duration: 420,
        },
      ],
    });
    stashdbAdapter.searchStudios = jest.fn().mockResolvedValue([
      {
        id: 'studio-1',
        name: 'Studio',
        childStudios: [{ id: 'studio-1a', name: 'Studio Child' }],
      },
    ]);
    stashdbAdapter.favoritePerformer = jest.fn().mockResolvedValue({
      favorited: true,
      alreadyFavorited: false,
    });
    sceneStatusService.resolveForScenes = jest
      .fn()
      .mockResolvedValue(new Map([['scene-1', { state: 'AVAILABLE' }]]));
  });

  it('uses default query behavior for performers feed', async () => {
    await expect(service.getPerformersFeed(1, 50)).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 50,
      hasMore: false,
      items: [
        {
          id: 'p-1',
          name: 'Performer One',
          gender: 'FEMALE',
          sceneCount: 12,
          isFavorite: true,
          imageUrl: null,
        },
      ],
    });

    expect(stashdbAdapter.getPerformersFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 50,
      name: undefined,
      gender: undefined,
      sort: 'NAME',
      favoritesOnly: false,
    });
  });

  it('forwards all filters to stashdb adapter', async () => {
    await service.getPerformersFeed(2, 25, {
      name: 'aj',
      gender: 'FEMALE',
      sort: 'SCENE_COUNT',
      favoritesOnly: true,
    });

    expect(stashdbAdapter.getPerformersFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 2,
      perPage: 25,
      name: 'aj',
      gender: 'FEMALE',
      sort: 'SCENE_COUNT',
      favoritesOnly: true,
    });
  });

  it('returns normalized performer details', async () => {
    await expect(service.getPerformerById('p-1')).resolves.toMatchObject({
      id: 'p-1',
      name: 'Performer One',
      gender: 'FEMALE',
      isFavorite: true,
    });
  });

  it('returns performer-scoped scenes with DATE default sort', async () => {
    await expect(service.getPerformerScenes('p-1', 1, 25)).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 25,
      hasMore: false,
      items: [
        {
          id: 'scene-1',
          title: 'Scene One',
          description: 'Details',
          imageUrl: 'http://image',
          studioId: 'studio-1',
          studio: 'Studio',
          studioImageUrl: 'http://studio-image',
          releaseDate: '2026-03-02',
          duration: 420,
          type: 'SCENE',
          source: 'STASHDB',
          status: { state: 'AVAILABLE' },
        },
      ],
    });

    expect(stashdbAdapter.getScenesForPerformer).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      performerId: 'p-1',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      studioIds: [],
      tagIds: [],
      onlyFavoriteStudios: false,
    });
  });

  it('forwards performer-scoped scene filters', async () => {
    await service.getPerformerScenes('p-1', 2, 20, {
      sort: 'UPDATED_AT',
      studioIds: ['studio-1', 'studio-1'],
      tagIds: ['tag-1'],
      onlyFavoriteStudios: true,
    });

    expect(stashdbAdapter.getScenesForPerformer).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      performerId: 'p-1',
      page: 2,
      perPage: 20,
      sort: 'UPDATED_AT',
      studioIds: ['studio-1'],
      tagIds: ['tag-1'],
      onlyFavoriteStudios: true,
    });
  });

  it('searches studios from stashdb', async () => {
    await expect(service.searchStudios('team')).resolves.toEqual([
      {
        id: 'studio-1',
        name: 'Studio',
        childStudios: [{ id: 'studio-1a', name: 'Studio Child' }],
      },
    ]);
  });

  it('favorites performer by id', async () => {
    await expect(service.favoritePerformer('p-1')).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });

    expect(stashdbAdapter.favoritePerformer).toHaveBeenCalledWith('p-1', {
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
    });
  });
});
