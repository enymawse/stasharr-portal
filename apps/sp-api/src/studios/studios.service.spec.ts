import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { StudiosService } from './studios.service';

describe('StudiosService', () => {
  const integrationsService = {
    findOne: jest.fn(),
  } as unknown as IntegrationsService;

  const stashdbAdapter = {
    getStudiosFeed: jest.fn(),
  } as unknown as StashdbAdapter;

  const stashdbIntegration = {
    enabled: true,
    status: IntegrationStatus.CONFIGURED,
    baseUrl: 'http://stashdb.local/graphql',
    apiKey: 'stashdb-key',
  };

  let service: StudiosService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StudiosService(integrationsService, stashdbAdapter);

    integrationsService.findOne = jest
      .fn()
      .mockImplementation((type: IntegrationType) => {
        if (type === IntegrationType.STASHDB) {
          return stashdbIntegration;
        }

        throw new Error('Unexpected integration type');
      });

    stashdbAdapter.getStudiosFeed = jest.fn().mockResolvedValue({
      total: 1,
      studios: [
        {
          id: 'studio-1',
          name: 'Studio One',
          isFavorite: true,
          imageUrl: 'http://studio-image',
          parentStudio: null,
          childStudios: [{ id: 'child-1', name: 'Studio Child' }],
        },
      ],
    });
  });

  it('uses default query behavior for studios feed', async () => {
    await expect(service.getStudiosFeed(1, 50)).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 50,
      hasMore: false,
      items: [
        {
          id: 'studio-1',
          name: 'Studio One',
          isFavorite: true,
          imageUrl: 'http://studio-image',
          parentStudio: null,
          childStudios: [{ id: 'child-1', name: 'Studio Child' }],
        },
      ],
    });

    expect(stashdbAdapter.getStudiosFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 50,
      name: undefined,
      sort: 'NAME',
      direction: 'ASC',
      favoritesOnly: false,
    });
  });

  it('forwards selected studios filters to stashdb adapter', async () => {
    await service.getStudiosFeed(2, 25, {
      name: 'brazz',
      sort: 'UPDATED_AT',
      favoritesOnly: true,
    });

    expect(stashdbAdapter.getStudiosFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 2,
      perPage: 25,
      name: 'brazz',
      sort: 'UPDATED_AT',
      direction: 'ASC',
      favoritesOnly: true,
    });
  });

  it('forwards explicit studios feed direction', async () => {
    await service.getStudiosFeed(1, 50, {
      sort: 'NAME',
      direction: 'DESC',
    });

    expect(stashdbAdapter.getStudiosFeed).toHaveBeenCalledWith({
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
      page: 1,
      perPage: 50,
      name: undefined,
      sort: 'NAME',
      direction: 'DESC',
      favoritesOnly: false,
    });
  });
});
