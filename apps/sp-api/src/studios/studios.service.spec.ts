import { NotFoundException } from '@nestjs/common';
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
    getStudioById: jest.fn(),
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
    stashdbAdapter.getStudioById = jest.fn().mockResolvedValue({
      id: 'studio-1',
      name: 'Studio One',
      aliases: ['Alias One'],
      deleted: false,
      isFavorite: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-02-01',
      imageUrl: 'http://studio-image',
      images: [
        {
          id: 'img-1',
          url: 'http://studio-image',
          width: 400,
          height: 220,
        },
      ],
      urls: [
        {
          url: 'https://stashdb.org/studios/studio-1',
          type: 'DETAILS',
          siteName: 'StashDB',
          siteUrl: 'https://stashdb.org',
          siteIcon: null,
        },
      ],
      parentStudio: {
        id: 'parent-1',
        name: 'Parent Studio',
        aliases: ['Parent Alias'],
        isFavorite: false,
        urls: [],
      },
      childStudios: [
        {
          id: 'child-1',
          name: 'Child Studio',
          aliases: [],
          deleted: false,
          isFavorite: false,
          createdAt: null,
          updatedAt: null,
          imageUrl: null,
        },
      ],
    });
  });

  it('uses default query behavior for studios feed', async () => {
    await expect(service.getStudiosFeed()).resolves.toEqual({
      total: 1,
      page: 1,
      perPage: 24,
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
      perPage: 24,
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

  it('returns normalized studio details by id', async () => {
    await expect(service.getStudioById('studio-1')).resolves.toEqual({
      id: 'studio-1',
      name: 'Studio One',
      aliases: ['Alias One'],
      deleted: false,
      isFavorite: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-02-01',
      imageUrl: 'http://studio-image',
      images: [
        {
          id: 'img-1',
          url: 'http://studio-image',
          width: 400,
          height: 220,
        },
      ],
      urls: [
        {
          url: 'https://stashdb.org/studios/studio-1',
          type: 'DETAILS',
          siteName: 'StashDB',
          siteUrl: 'https://stashdb.org',
          siteIcon: null,
        },
      ],
      parentStudio: {
        id: 'parent-1',
        name: 'Parent Studio',
        aliases: ['Parent Alias'],
        isFavorite: false,
        urls: [],
      },
      childStudios: [
        {
          id: 'child-1',
          name: 'Child Studio',
          aliases: [],
          deleted: false,
          isFavorite: false,
          createdAt: null,
          updatedAt: null,
          imageUrl: null,
        },
      ],
    });

    expect(stashdbAdapter.getStudioById).toHaveBeenCalledWith('studio-1', {
      baseUrl: stashdbIntegration.baseUrl,
      apiKey: stashdbIntegration.apiKey,
    });
  });

  it('rejects studio details fetch when id is empty', async () => {
    await expect(service.getStudioById('   ')).rejects.toThrow(
      'Studio id is required.',
    );
  });

  it('propagates not-found when studio details are missing', async () => {
    stashdbAdapter.getStudioById = jest
      .fn()
      .mockRejectedValue(new NotFoundException('missing'));

    await expect(service.getStudioById('studio-404')).rejects.toThrow(
      NotFoundException,
    );
  });
});
