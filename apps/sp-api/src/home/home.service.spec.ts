import { BadRequestException } from '@nestjs/common';
import { HomeRailKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HomeService } from './home.service';

describe('HomeService', () => {
  const upsertMock = jest.fn();
  const findManyMock = jest.fn();
  const updateMock = jest.fn();
  const transactionMock = jest.fn();

  const prismaService = {
    homeRail: {
      upsert: upsertMock,
      findMany: findManyMock,
      update: updateMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  let service: HomeService;

  beforeEach(() => {
    jest.clearAllMocks();

    transactionMock.mockImplementation((operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    );

    service = new HomeService(prismaService);
  });

  it('bootstraps default rails on first fetch', async () => {
    upsertMock.mockResolvedValue({});
    findManyMock.mockResolvedValue([
      {
        id: 'rail-1',
        key: HomeRailKey.FAVORITE_STUDIOS,
        title: 'Latest From Favorite Studios',
        subtitle: 'Studios subtitle',
        enabled: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'rail-2',
        key: HomeRailKey.FAVORITE_PERFORMERS,
        title: 'Latest From Favorite Performers',
        subtitle: 'Performers subtitle',
        enabled: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await service.getRails();

    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(findManyMock).toHaveBeenCalledWith({
      orderBy: { sortOrder: 'asc' },
    });
    expect(result.map((rail) => rail.key)).toEqual([
      'FAVORITE_STUDIOS',
      'FAVORITE_PERFORMERS',
    ]);
    expect(result[0]).toMatchObject({
      key: 'FAVORITE_STUDIOS',
      favorites: 'STUDIO',
      sortOrder: 0,
    });
  });

  it('returns ordered rails from persisted sortOrder', async () => {
    upsertMock.mockResolvedValue({});
    findManyMock.mockResolvedValue([
      {
        id: 'rail-2',
        key: HomeRailKey.FAVORITE_PERFORMERS,
        title: 'Latest From Favorite Performers',
        subtitle: 'Performers subtitle',
        enabled: false,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'rail-1',
        key: HomeRailKey.FAVORITE_STUDIOS,
        title: 'Latest From Favorite Studios',
        subtitle: 'Studios subtitle',
        enabled: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await service.getRails();

    expect(result.map((rail) => rail.key)).toEqual([
      'FAVORITE_PERFORMERS',
      'FAVORITE_STUDIOS',
    ]);
    expect(result[0].enabled).toBe(false);
    expect(result[1].enabled).toBe(true);
  });

  it('updates enabled state and order from the submitted list', async () => {
    upsertMock.mockResolvedValue({});
    updateMock.mockResolvedValue({});
    findManyMock.mockResolvedValue([
      {
        id: 'rail-2',
        key: HomeRailKey.FAVORITE_PERFORMERS,
        title: 'Latest From Favorite Performers',
        subtitle: 'Performers subtitle',
        enabled: false,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'rail-1',
        key: HomeRailKey.FAVORITE_STUDIOS,
        title: 'Latest From Favorite Studios',
        subtitle: 'Studios subtitle',
        enabled: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const result = await service.updateRails({
      rails: [
        { key: 'FAVORITE_PERFORMERS', enabled: false },
        { key: 'FAVORITE_STUDIOS', enabled: true },
      ],
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenNthCalledWith(1, {
      where: { key: 'FAVORITE_PERFORMERS' },
      data: { enabled: false, sortOrder: 0 },
    });
    expect(updateMock).toHaveBeenNthCalledWith(2, {
      where: { key: 'FAVORITE_STUDIOS' },
      data: { enabled: true, sortOrder: 1 },
    });
    expect(result.map((rail) => rail.key)).toEqual([
      'FAVORITE_PERFORMERS',
      'FAVORITE_STUDIOS',
    ]);
  });

  it('rejects duplicate rail keys', async () => {
    await expect(
      service.updateRails({
        rails: [
          { key: 'FAVORITE_STUDIOS', enabled: true },
          { key: 'FAVORITE_STUDIOS', enabled: false },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects payloads that do not include both built-in rails', async () => {
    await expect(
      service.updateRails({
        rails: [{ key: 'FAVORITE_STUDIOS', enabled: true }],
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
