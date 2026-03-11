import { IntegrationStatus, IntegrationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from './integrations.service';

interface ResetUpsertArgs {
  where: { type: IntegrationType };
  update: {
    enabled: boolean;
    status: IntegrationStatus;
    name: null;
    baseUrl: null;
    apiKey: null;
    config: typeof Prisma.JsonNull;
    lastHealthyAt: null;
    lastErrorAt: null;
    lastErrorMessage: null;
  };
  create: {
    type: IntegrationType;
    enabled: boolean;
    status: IntegrationStatus;
    name: null;
    baseUrl: null;
    apiKey: null;
    config: typeof Prisma.JsonNull;
    lastHealthyAt: null;
    lastErrorAt: null;
    lastErrorMessage: null;
  };
}

describe('IntegrationsService', () => {
  const upsert = jest.fn<(args: ResetUpsertArgs) => Promise<unknown>>();
  const transaction = jest.fn();

  const prisma = {
    integrationConfig: {
      upsert,
    },
    $transaction: transaction,
  } as unknown as PrismaService;

  let service: IntegrationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new IntegrationsService(prisma);
  });

  it('resets a single integration to NOT_CONFIGURED with cleared config', async () => {
    upsert.mockResolvedValue({
      type: IntegrationType.STASH,
    });

    await service.reset(IntegrationType.STASH);

    const expectedArgs: ResetUpsertArgs = {
      where: { type: IntegrationType.STASH },
      update: {
        enabled: true,
        status: IntegrationStatus.NOT_CONFIGURED,
        name: null,
        baseUrl: null,
        apiKey: null,
        config: Prisma.JsonNull,
        lastHealthyAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
      create: {
        type: IntegrationType.STASH,
        enabled: true,
        status: IntegrationStatus.NOT_CONFIGURED,
        name: null,
        baseUrl: null,
        apiKey: null,
        config: Prisma.JsonNull,
        lastHealthyAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    };

    expect(upsert).toHaveBeenCalledWith(expectedArgs);
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
});
