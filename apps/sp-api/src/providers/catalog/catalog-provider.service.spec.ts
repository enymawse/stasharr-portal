import { BadRequestException, ConflictException } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../../integrations/integrations.service';
import { CatalogProviderService } from './catalog-provider.service';

describe('CatalogProviderService', () => {
  const integrationsService = {
    findAll: jest.fn(),
    findOne: jest.fn(),
  } as unknown as IntegrationsService;

  let service: CatalogProviderService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CatalogProviderService(integrationsService);
  });

  it('resolves STASHDB as the active catalog provider when enabled', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: true,
      },
      {
        type: IntegrationType.FANSDB,
        enabled: false,
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.STASHDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: 'http://stashdb.local/graphql',
      apiKey: 'stashdb-key',
    });

    await expect(service.getActiveCatalogProvider()).resolves.toEqual({
      integrationType: 'STASHDB',
      providerKey: 'STASHDB',
      label: 'StashDB',
      baseUrl: 'http://stashdb.local/graphql',
      apiKey: 'stashdb-key',
    });
  });

  it('resolves FANSDB as the active catalog provider when enabled', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: false,
      },
      {
        type: IntegrationType.FANSDB,
        enabled: true,
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.FANSDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: 'http://fansdb.local/graphql',
      apiKey: 'fansdb-key',
    });

    await expect(service.getActiveCatalogProvider()).resolves.toEqual({
      integrationType: 'FANSDB',
      providerKey: 'FANSDB',
      label: 'FansDB',
      baseUrl: 'http://fansdb.local/graphql',
      apiKey: 'fansdb-key',
    });
  });

  it('prefers a configured provider over an earlier enabled but unconfigured provider', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: true,
        status: IntegrationStatus.NOT_CONFIGURED,
        baseUrl: null,
      },
      {
        type: IntegrationType.FANSDB,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://fansdb.local/graphql',
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.FANSDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: 'http://fansdb.local/graphql',
      apiKey: 'fansdb-key',
    });

    await expect(service.getActiveCatalogProvider()).resolves.toEqual({
      integrationType: 'FANSDB',
      providerKey: 'FANSDB',
      label: 'FansDB',
      baseUrl: 'http://fansdb.local/graphql',
      apiKey: 'fansdb-key',
    });
  });

  it('throws when the selected catalog provider is missing a base URL', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.FANSDB,
        enabled: true,
      },
    ]);
    integrationsService.findOne = jest.fn().mockResolvedValue({
      type: IntegrationType.FANSDB,
      enabled: true,
      status: IntegrationStatus.CONFIGURED,
      baseUrl: '   ',
      apiKey: null,
    });

    await expect(service.getActiveCatalogProvider()).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws when no catalog provider is enabled', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASHDB,
        enabled: false,
      },
      {
        type: IntegrationType.FANSDB,
        enabled: false,
      },
    ]);

    await expect(service.getActiveCatalogProvider()).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
