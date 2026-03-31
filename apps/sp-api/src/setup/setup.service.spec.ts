import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';
import { SetupService } from './setup.service';

describe('SetupService', () => {
  const integrationsService = {
    findAll: jest.fn(),
  } as unknown as IntegrationsService;

  let service: SetupService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SetupService(integrationsService);
  });

  it('reports setup complete when stash, whisparr, and an active catalog provider are configured', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASH,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
      },
      {
        type: IntegrationType.WHISPARR,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
      },
      {
        type: IntegrationType.FANSDB,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
        baseUrl: 'http://fansdb.local/graphql',
      },
      {
        type: IntegrationType.STASHDB,
        enabled: false,
        status: IntegrationStatus.CONFIGURED,
      },
    ]);

    await expect(service.getStatus()).resolves.toEqual({
      setupComplete: true,
      required: {
        stash: true,
        catalog: true,
        whisparr: true,
      },
      activeCatalogProvider: 'FANSDB',
      catalogProviders: {
        STASHDB: true,
        FANSDB: true,
      },
    });
  });

  it('reports catalog setup incomplete when no active catalog provider is enabled', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASH,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
      },
      {
        type: IntegrationType.WHISPARR,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
      },
      {
        type: IntegrationType.STASHDB,
        enabled: false,
        status: IntegrationStatus.CONFIGURED,
      },
      {
        type: IntegrationType.FANSDB,
        enabled: false,
        status: IntegrationStatus.NOT_CONFIGURED,
      },
    ]);

    await expect(service.getStatus()).resolves.toEqual({
      setupComplete: false,
      required: {
        stash: true,
        catalog: false,
        whisparr: true,
      },
      activeCatalogProvider: null,
      catalogProviders: {
        STASHDB: true,
        FANSDB: false,
      },
    });
  });

  it('prefers a configured active catalog provider over an earlier enabled but incomplete one', async () => {
    integrationsService.findAll = jest.fn().mockResolvedValue([
      {
        type: IntegrationType.STASH,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
      },
      {
        type: IntegrationType.WHISPARR,
        enabled: true,
        status: IntegrationStatus.CONFIGURED,
      },
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

    await expect(service.getStatus()).resolves.toEqual({
      setupComplete: true,
      required: {
        stash: true,
        catalog: true,
        whisparr: true,
      },
      activeCatalogProvider: 'FANSDB',
      catalogProviders: {
        STASHDB: false,
        FANSDB: true,
      },
    });
  });
});
