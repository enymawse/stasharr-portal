import { IntegrationStatus, IntegrationType, Prisma } from '@prisma/client';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from './integrations.service';

describe('IntegrationsService', () => {
  const upsert = jest.fn<Promise<unknown>, [Record<string, unknown>]>();
  const findUnique = jest.fn();
  const transaction = jest.fn();
  const stashTestConnection = jest.fn();
  const stashdbTestConnection = jest.fn();
  const whisparrTestConnection = jest.fn();

  const prisma = {
    integrationConfig: {
      upsert,
      findUnique,
    },
    $transaction: transaction,
  } as unknown as PrismaService;

  const stashAdapter = {
    testConnection: stashTestConnection,
  } as unknown as StashAdapter;

  const stashdbAdapter = {
    testConnection: stashdbTestConnection,
  } as unknown as StashdbAdapter;

  const whisparrAdapter = {
    testConnection: whisparrTestConnection,
  } as unknown as WhisparrAdapter;

  let service: IntegrationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IntegrationsService(
      prisma,
      stashAdapter,
      stashdbAdapter,
      whisparrAdapter,
    );
  });

  it('resets a single integration to NOT_CONFIGURED with cleared config', async () => {
    upsert.mockResolvedValue({
      type: IntegrationType.STASH,
    });

    await service.reset(IntegrationType.STASH);

    expect(upsert).toHaveBeenCalledWith({
      where: { type: IntegrationType.STASH },
      update: {
        enabled: true,
        name: null,
        baseUrl: null,
        apiKey: null,
        config: Prisma.JsonNull,
        status: IntegrationStatus.NOT_CONFIGURED,
        lastHealthyAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
      create: {
        type: IntegrationType.STASH,
        enabled: true,
        name: null,
        baseUrl: null,
        apiKey: null,
        config: Prisma.JsonNull,
        status: IntegrationStatus.NOT_CONFIGURED,
        lastHealthyAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    });
  });

  it('resets all integrations and returns them sorted by type', async () => {
    transaction.mockResolvedValue([
      { type: IntegrationType.WHISPARR },
      { type: IntegrationType.STASH },
      { type: IntegrationType.STASHDB },
    ]);

    const result = await service.resetAll();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(result.map((integration) => integration.type)).toEqual([
      IntegrationType.STASH,
      IntegrationType.STASHDB,
      IntegrationType.WHISPARR,
    ]);
  });

  it('tests stash integration and stores success metadata', async () => {
    findUnique.mockResolvedValue({
      type: IntegrationType.STASH,
      baseUrl: 'http://stash.local',
      apiKey: 'token',
    });
    (stashAdapter.testConnection as jest.Mock).mockResolvedValue(undefined);
    upsert.mockResolvedValue({
      type: IntegrationType.STASH,
      status: IntegrationStatus.CONFIGURED,
      lastErrorMessage: null,
    });

    await expect(
      service.testIntegration(IntegrationType.STASH, {}),
    ).resolves.toMatchObject({
      type: IntegrationType.STASH,
      status: IntegrationStatus.CONFIGURED,
    });

    expect(stashTestConnection).toHaveBeenCalledWith({
      baseUrl: 'http://stash.local',
      apiKey: 'token',
    });
    const stashUpsertCall = upsert.mock.calls[0]?.[0] as {
      where: { type: IntegrationType };
      update: {
        status: IntegrationStatus;
        lastHealthyAt: Date | null;
        lastErrorAt: Date | null;
        lastErrorMessage: string | null;
      };
    };
    expect(stashUpsertCall.where.type).toBe(IntegrationType.STASH);
    expect(stashUpsertCall.update.status).toBe(IntegrationStatus.CONFIGURED);
    expect(stashUpsertCall.update.lastHealthyAt).toBeInstanceOf(Date);
    expect(stashUpsertCall.update.lastErrorAt).toBeNull();
    expect(stashUpsertCall.update.lastErrorMessage).toBeNull();
  });

  it('stores error metadata when integration test fails', async () => {
    findUnique.mockResolvedValue({
      type: IntegrationType.WHISPARR,
      baseUrl: 'http://whisparr.local',
      apiKey: 'token',
    });
    whisparrTestConnection.mockRejectedValue(new Error('bad credentials'));
    upsert.mockResolvedValue({
      type: IntegrationType.WHISPARR,
      status: IntegrationStatus.ERROR,
      lastErrorMessage: 'bad credentials',
    });

    await expect(
      service.testIntegration(IntegrationType.WHISPARR, {}),
    ).resolves.toMatchObject({
      type: IntegrationType.WHISPARR,
      status: IntegrationStatus.ERROR,
      lastErrorMessage: 'bad credentials',
    });

    const whisparrUpsertCall = upsert.mock.calls[0]?.[0] as {
      where: { type: IntegrationType };
      update: {
        status: IntegrationStatus;
        lastErrorAt: Date | null;
        lastErrorMessage: string | null;
      };
    };
    expect(whisparrUpsertCall.where.type).toBe(IntegrationType.WHISPARR);
    expect(whisparrUpsertCall.update.status).toBe(IntegrationStatus.ERROR);
    expect(whisparrUpsertCall.update.lastErrorAt).toBeInstanceOf(Date);
    expect(whisparrUpsertCall.update.lastErrorMessage).toBe('bad credentials');
  });
});
