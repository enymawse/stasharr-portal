import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  HomeRailContentType,
  HomeRailKey,
  HomeRailKind,
  HomeRailSource,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HomeService } from './home.service';

const now = new Date('2026-03-24T00:00:00.000Z');

function buildRail(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rail-default',
    key: null,
    kind: HomeRailKind.CUSTOM,
    source: HomeRailSource.STASHDB,
    contentType: HomeRailContentType.SCENES,
    title: 'Custom Rail',
    subtitle: 'Custom subtitle',
    enabled: true,
    sortOrder: 0,
    config: {
      sort: 'DATE',
      direction: 'DESC',
      favorites: null,
      tagIds: [],
      tagNames: [],
      tagMode: null,
      studioIds: [],
      studioNames: [],
      limit: 16,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('HomeService', () => {
  const upsertMock = jest.fn();
  const findManyMock = jest.fn();
  const updateMock = jest.fn();
  const transactionMock = jest.fn();
  const findFirstMock = jest.fn();
  const createMock = jest.fn();
  const findUniqueMock = jest.fn();
  const deleteMock = jest.fn();

  const prismaService = {
    homeRail: {
      upsert: upsertMock,
      findMany: findManyMock,
      update: updateMock,
      findFirst: findFirstMock,
      create: createMock,
      findUnique: findUniqueMock,
      delete: deleteMock,
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

  it('bootstraps built-in rails and returns them in sort order', async () => {
    upsertMock.mockResolvedValue({});
    findManyMock.mockResolvedValue([
      buildRail({
        id: 'built-in-1',
        key: HomeRailKey.FAVORITE_STUDIOS,
        kind: HomeRailKind.BUILTIN,
        title: 'Latest From Favorite Studios',
        subtitle: 'Studios subtitle',
        sortOrder: 0,
      }),
      buildRail({
        id: 'built-in-2',
        key: HomeRailKey.FAVORITE_PERFORMERS,
        kind: HomeRailKind.BUILTIN,
        title: 'Latest From Favorite Performers',
        subtitle: 'Performers subtitle',
        sortOrder: 1,
        config: null,
      }),
    ]);

    const result = await service.getRails();

    expect(upsertMock).toHaveBeenCalledTimes(2);
    expect(findManyMock).toHaveBeenCalledWith({ orderBy: { sortOrder: 'asc' } });
    expect(result.map((rail) => rail.key)).toEqual([
      'FAVORITE_STUDIOS',
      'FAVORITE_PERFORMERS',
    ]);
    expect(result[0]).toMatchObject({
      kind: 'BUILTIN',
      editable: false,
      deletable: false,
      config: { favorites: 'STUDIO', limit: 16 },
    });
    expect(result[1]?.config.favorites).toBe('PERFORMER');
  });

  it('creates a custom StashDB scenes rail', async () => {
    upsertMock.mockResolvedValue({});
    findFirstMock.mockResolvedValue(buildRail({ id: 'built-in-2', sortOrder: 1 }));
    createMock.mockResolvedValue(
      buildRail({
        id: 'custom-1',
        title: 'Weekend Queue',
        subtitle: null,
        sortOrder: 2,
        config: {
          sort: 'TRENDING',
          direction: 'ASC',
          favorites: 'ALL',
          tagIds: ['tag-1', 'tag-1', 'tag-2'],
          tagNames: ['Feature', 'Feature', 'Spotlight'],
          tagMode: 'AND',
          studioIds: ['studio-1'],
          studioNames: ['Pulse'],
          limit: 40,
        },
      }),
    );

    const result = await service.createRail({
      title: ' Weekend Queue ',
      subtitle: '  ',
      enabled: true,
      config: {
        sort: 'TRENDING',
        direction: 'ASC',
        favorites: 'ALL',
        tagIds: ['tag-1', 'tag-1', 'tag-2'],
        tagNames: ['Feature', 'Feature', 'Spotlight'],
        tagMode: 'AND',
        studioIds: ['studio-1'],
        studioNames: ['Pulse'],
        limit: 40,
      },
    });

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: null,
        kind: 'CUSTOM',
        source: 'STASHDB',
        contentType: 'SCENES',
        title: 'Weekend Queue',
        subtitle: null,
        sortOrder: 2,
        config: {
          sort: 'TRENDING',
          direction: 'ASC',
          favorites: 'ALL',
          tagIds: ['tag-1', 'tag-2'],
          tagNames: ['Feature', 'Spotlight'],
          tagMode: 'AND',
          studioIds: ['studio-1'],
          studioNames: ['Pulse'],
          limit: 30,
        },
      }),
    });
    expect(result).toMatchObject({
      id: 'custom-1',
      kind: 'CUSTOM',
      editable: true,
      deletable: true,
    });
  });

  it('updates a custom rail config and metadata', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildRail({
        id: 'custom-1',
      }),
    );
    updateMock.mockResolvedValue(
      buildRail({
        id: 'custom-1',
        title: 'Fresh Picks',
        subtitle: 'Updated subtitle',
        enabled: false,
        config: {
          sort: 'UPDATED_AT',
          direction: 'DESC',
          favorites: null,
          tagIds: [],
          tagNames: [],
          tagMode: null,
          studioIds: ['studio-2', 'studio-3'],
          studioNames: ['North', 'South'],
          limit: 12,
        },
      }),
    );

    const result = await service.updateRail('custom-1', {
      title: 'Fresh Picks',
      subtitle: 'Updated subtitle',
      enabled: false,
      config: {
        sort: 'UPDATED_AT',
        direction: 'DESC',
        favorites: null,
        tagIds: [],
        tagNames: [],
        tagMode: null,
        studioIds: ['studio-2', 'studio-3'],
        studioNames: ['North', 'South'],
        limit: 12,
      },
    });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'custom-1' },
      data: expect.objectContaining({
        title: 'Fresh Picks',
        subtitle: 'Updated subtitle',
        enabled: false,
      }),
    });
    expect(result).toMatchObject({
      id: 'custom-1',
      title: 'Fresh Picks',
      enabled: false,
      config: {
        sort: 'UPDATED_AT',
        studioIds: ['studio-2', 'studio-3'],
      },
    });
  });

  it('deletes a custom rail and reindexes sort order', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(buildRail({ id: 'custom-1', sortOrder: 1 }));
    deleteMock.mockResolvedValue({});
    findManyMock.mockResolvedValue([
      buildRail({
        id: 'built-in-1',
        key: HomeRailKey.FAVORITE_STUDIOS,
        kind: HomeRailKind.BUILTIN,
        sortOrder: 0,
      }),
      buildRail({
        id: 'built-in-2',
        key: HomeRailKey.FAVORITE_PERFORMERS,
        kind: HomeRailKind.BUILTIN,
        sortOrder: 2,
      }),
    ]);
    updateMock.mockResolvedValue({});

    await service.deleteRail('custom-1');

    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 'custom-1' } });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'built-in-2' },
      data: { sortOrder: 1 },
    });
  });

  it('rejects deletion of a built-in rail', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildRail({
        id: 'built-in-1',
        key: HomeRailKey.FAVORITE_STUDIOS,
        kind: HomeRailKind.BUILTIN,
      }),
    );

    await expect(service.deleteRail('built-in-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects editing a missing rail', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(null);

    await expect(
      service.updateRail('missing', {
        title: 'Missing',
        subtitle: null,
        enabled: true,
        config: {
          sort: 'DATE',
          direction: 'DESC',
          favorites: null,
          tagIds: [],
          tagNames: [],
          tagMode: null,
          studioIds: [],
          studioNames: [],
          limit: 16,
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates enabled state and order by persisted rail id', async () => {
    const rails = [
      buildRail({
        id: 'built-in-1',
        key: HomeRailKey.FAVORITE_STUDIOS,
        kind: HomeRailKind.BUILTIN,
        sortOrder: 0,
      }),
      buildRail({ id: 'custom-1', sortOrder: 1 }),
      buildRail({
        id: 'built-in-2',
        key: HomeRailKey.FAVORITE_PERFORMERS,
        kind: HomeRailKind.BUILTIN,
        sortOrder: 2,
      }),
    ];
    upsertMock.mockResolvedValue({});
    updateMock.mockResolvedValue({});
    findManyMock
      .mockResolvedValueOnce(rails)
      .mockResolvedValueOnce([
        rails[2],
        { ...rails[0], enabled: false, sortOrder: 1 },
        { ...rails[1], enabled: true, sortOrder: 2 },
      ]);

    const result = await service.updateRails({
      rails: [
        { id: 'built-in-2', enabled: true },
        { id: 'built-in-1', enabled: false },
        { id: 'custom-1', enabled: true },
      ],
    });

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'built-in-2' },
      data: { enabled: true, sortOrder: 0 },
    });
    expect(updateMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'built-in-1' },
      data: { enabled: false, sortOrder: 1 },
    });
    expect(updateMock).toHaveBeenNthCalledWith(3, {
      where: { id: 'custom-1' },
      data: { enabled: true, sortOrder: 2 },
    });
    expect(result.map((rail) => rail.id)).toEqual([
      'built-in-2',
      'built-in-1',
      'custom-1',
    ]);
  });

  it('rejects duplicate ids in the reorder payload', async () => {
    upsertMock.mockResolvedValue({});
    findManyMock.mockResolvedValue([
      buildRail({ id: 'built-in-1', key: HomeRailKey.FAVORITE_STUDIOS, kind: HomeRailKind.BUILTIN }),
      buildRail({ id: 'built-in-2', key: HomeRailKey.FAVORITE_PERFORMERS, kind: HomeRailKind.BUILTIN }),
    ]);

    await expect(
      service.updateRails({
        rails: [
          { id: 'built-in-1', enabled: true },
          { id: 'built-in-1', enabled: false },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
