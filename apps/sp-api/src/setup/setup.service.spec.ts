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

  it('reports setup complete when stash, whisparr, and a configured catalog provider are present', async () => {
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
        enabled: false,
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
      catalogProvider: 'FANSDB',
    });
  });

  it('reports catalog setup incomplete when no catalog provider is configured', async () => {
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
        status: IntegrationStatus.NOT_CONFIGURED,
        baseUrl: null,
      },
    ]);

    await expect(service.getStatus()).resolves.toEqual({
      setupComplete: false,
      required: {
        stash: true,
        catalog: false,
        whisparr: true,
      },
      catalogProvider: null,
    });
  });

  it('prefers the enabled configured provider when legacy data still has both catalogs saved', async () => {
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
        baseUrl: 'http://stashdb.local/graphql',
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
      catalogProvider: 'FANSDB',
    });
  });
});
