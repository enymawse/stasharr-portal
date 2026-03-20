import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { PerformersService } from './performers.service';

describe('PerformersService', () => {
  const integrationsService = {
    findOne: jest.fn(),
  } as unknown as IntegrationsService;

  const stashdbAdapter = {
    getPerformersFeed: jest.fn(),
  } as unknown as StashdbAdapter;

  const stashdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stashdb.local/graphql',
    apiKey: 'stashdb-key',
  };

  let service: PerformersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PerformersService(integrationsService, stashdbAdapter);

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
});
