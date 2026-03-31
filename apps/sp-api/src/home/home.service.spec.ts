import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  HomeRailContentType,
  HomeRailKey,
  HomeRailKind,
  HomeRailSource,
} from '@prisma/client';
import { LibraryService } from '../library/library.service';
import { PrismaService } from '../prisma/prisma.service';
import { SceneStatusService } from '../scene-status/scene-status.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { HybridScenesService } from '../hybrid-scenes/hybrid-scenes.service';
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

function buildStashRail(overrides: Partial<Record<string, unknown>> = {}) {
  return buildRail({
    source: HomeRailSource.STASH,
    config: {
      sort: 'CREATED_AT',
      direction: 'DESC',
      titleQuery: null,
      tagIds: [],
      tagNames: [],
      tagMode: null,
      studioIds: [],
      studioNames: [],
      favoritePerformersOnly: false,
      favoriteStudiosOnly: false,
      favoriteTagsOnly: false,
      limit: 16,
    },
    ...overrides,
  });
}

function buildHybridRail(overrides: Partial<Record<string, unknown>> = {}) {
  return buildRail({
    source: HomeRailSource.HYBRID,
    config: {
      sort: 'DATE',
      direction: 'DESC',
      stashdbFavorites: null,
      tagIds: [],
      tagNames: [],
      tagMode: null,
      studioIds: [],
      studioNames: [],
      stashFavoritePerformersOnly: false,
      stashFavoriteStudiosOnly: false,
      stashFavoriteTagsOnly: false,
      libraryAvailability: 'MISSING_FROM_LIBRARY',
      limit: 16,
    },
    ...overrides,
  });
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
  const integrationFindUniqueMock = jest.fn();
  const libraryGetScenesPreviewMock = jest.fn();
  const libraryGetScenesFeedMock = jest.fn();
  const librarySearchTagsMock = jest.fn();
  const librarySearchStudiosMock = jest.fn();
  const stashGetLocalSceneFeedMock = jest.fn();
  const stashSearchTagsMock = jest.fn();
  const stashSearchStudiosMock = jest.fn();
  const stashFindScenesByStashIdMock = jest.fn();
  const stashdbGetScenesBySortMock = jest.fn();
  const sceneStatusResolveForScenesMock = jest.fn();

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
    integrationConfig: {
      findUnique: integrationFindUniqueMock,
    },
    $transaction: transactionMock,
  } as unknown as PrismaService;

  const libraryService = {
    getScenesPreview: libraryGetScenesPreviewMock,
    getScenesFeed: libraryGetScenesFeedMock,
    searchTags: librarySearchTagsMock,
    searchStudios: librarySearchStudiosMock,
  } as unknown as LibraryService;

  const stashAdapter = {
    getLocalSceneFeed: stashGetLocalSceneFeedMock,
    searchTags: stashSearchTagsMock,
    searchStudios: stashSearchStudiosMock,
    findScenesByStashId: stashFindScenesByStashIdMock,
  } as unknown as StashAdapter;

  const stashdbAdapter = {
    getScenesBySort: stashdbGetScenesBySortMock,
  } as unknown as StashdbAdapter;

  const sceneStatusService = {
    resolveForScenes: sceneStatusResolveForScenesMock,
  } as unknown as SceneStatusService;

  let service: HomeService;
  let hybridScenesService: HybridScenesService;

  beforeEach(() => {
    jest.clearAllMocks();
    transactionMock.mockImplementation((operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    );
    libraryGetScenesPreviewMock.mockResolvedValue([]);
    libraryGetScenesFeedMock.mockResolvedValue({
      total: 0,
      page: 1,
      perPage: 16,
      hasMore: false,
      items: [],
    });
    librarySearchTagsMock.mockResolvedValue([]);
    librarySearchStudiosMock.mockResolvedValue([]);
    sceneStatusResolveForScenesMock.mockResolvedValue(new Map());
    hybridScenesService = new HybridScenesService(stashAdapter, stashdbAdapter);
    service = new HomeService(
      prismaService,
      libraryService,
      sceneStatusService,
      hybridScenesService,
    );
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
      buildStashRail({
        id: 'built-in-3',
        key: HomeRailKey.RECENTLY_ADDED_LIBRARY,
        kind: HomeRailKind.BUILTIN,
        title: 'Recently Added to Library',
        subtitle: 'Library subtitle',
        sortOrder: 2,
      }),
    ]);

    const result = await service.getRails();

    expect(upsertMock).toHaveBeenCalledTimes(3);
    expect(findManyMock).toHaveBeenCalledWith({
      orderBy: { sortOrder: 'asc' },
    });
    expect(result.map((rail) => rail.key)).toEqual([
      'FAVORITE_STUDIOS',
      'FAVORITE_PERFORMERS',
      'RECENTLY_ADDED_LIBRARY',
    ]);
    expect(result[0]).toMatchObject({
      kind: 'BUILTIN',
      editable: false,
      deletable: false,
      config: { favorites: 'STUDIO', limit: 16 },
    });
    expect(result[1]).toMatchObject({
      config: { favorites: 'PERFORMER', limit: 16 },
    });
    expect(result[2]).toMatchObject({
      source: 'STASH',
      config: { sort: 'CREATED_AT', direction: 'DESC', limit: 16 },
    });
  });

  it('creates a custom StashDB scenes rail', async () => {
    upsertMock.mockResolvedValue({});
    findFirstMock.mockResolvedValue(
      buildStashRail({ id: 'built-in-3', sortOrder: 2 }),
    );
    createMock.mockResolvedValue(
      buildRail({
        id: 'custom-1',
        title: 'Weekend Queue',
        subtitle: null,
        sortOrder: 3,
        config: {
          sort: 'TRENDING',
          direction: 'ASC',
          favorites: 'ALL',
          tagIds: ['tag-1', 'tag-1', 'tag-2'],
          tagNames: ['Feature', 'Feature', 'Spotlight'],
          tagMode: 'AND',
          studioIds: ['studio-1'],
          studioNames: ['Pulse'],
          limit: 30,
        },
      }),
    );

    const result = await service.createRail({
      source: 'STASHDB',
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
        sortOrder: 3,
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

  it('creates a custom Stash rail with the constrained local-library config', async () => {
    upsertMock.mockResolvedValue({});
    findFirstMock.mockResolvedValue(
      buildStashRail({ id: 'built-in-3', sortOrder: 2 }),
    );
    createMock.mockResolvedValue(
      buildStashRail({
        id: 'custom-stash-1',
        title: 'Newest Library Scenes',
        subtitle: null,
        sortOrder: 3,
        config: {
          sort: 'CREATED_AT',
          direction: 'DESC',
          titleQuery: null,
          tagIds: [],
          tagNames: [],
          tagMode: null,
          studioIds: [],
          studioNames: [],
          favoritePerformersOnly: false,
          favoriteStudiosOnly: false,
          favoriteTagsOnly: false,
          limit: 22,
        },
      }),
    );

    const result = await service.createRail({
      source: 'STASH',
      title: ' Newest Library Scenes ',
      subtitle: '',
      enabled: true,
      config: {
        sort: 'CREATED_AT',
        direction: 'DESC',
        limit: 22,
      },
    });

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'STASH',
        title: 'Newest Library Scenes',
        config: {
          sort: 'CREATED_AT',
          direction: 'DESC',
          titleQuery: null,
          tagIds: [],
          tagNames: [],
          tagMode: null,
          studioIds: [],
          studioNames: [],
          favoritePerformersOnly: false,
          favoriteStudiosOnly: false,
          favoriteTagsOnly: false,
          limit: 22,
        },
      }),
    });
    expect(result).toMatchObject({
      id: 'custom-stash-1',
      source: 'STASH',
      config: {
        sort: 'CREATED_AT',
        direction: 'DESC',
        limit: 22,
      },
    });
  });

  it('creates a custom hybrid rail with explicit StashDB favorites and availability mode', async () => {
    upsertMock.mockResolvedValue({});
    findFirstMock.mockResolvedValue(
      buildStashRail({ id: 'built-in-3', sortOrder: 2 }),
    );
    createMock.mockResolvedValue(
      buildHybridRail({
        id: 'custom-hybrid-1',
        title: 'Missing Favorite Studios',
        subtitle: null,
        sortOrder: 3,
        config: {
          sort: 'DATE',
          direction: 'DESC',
          stashdbFavorites: 'STUDIO',
          tagIds: ['tag-1'],
          tagNames: ['Feature'],
          tagMode: 'AND',
          studioIds: ['studio-9'],
          studioNames: ['Pulse'],
          stashFavoritePerformersOnly: false,
          stashFavoriteStudiosOnly: false,
          stashFavoriteTagsOnly: false,
          libraryAvailability: 'MISSING_FROM_LIBRARY',
          limit: 18,
        },
      }),
    );

    const result = await service.createRail({
      source: 'HYBRID',
      title: ' Missing Favorite Studios ',
      subtitle: '',
      enabled: true,
      config: {
        sort: 'DATE',
        direction: 'DESC',
        stashdbFavorites: 'STUDIO',
        tagIds: ['tag-1'],
        tagNames: ['Feature'],
        tagMode: 'AND',
        studioIds: ['studio-9'],
        studioNames: ['Pulse'],
        stashFavoritePerformersOnly: false,
        stashFavoriteStudiosOnly: false,
        stashFavoriteTagsOnly: false,
        libraryAvailability: 'MISSING_FROM_LIBRARY',
        limit: 18,
      },
    });

    expect(createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: 'HYBRID',
        title: 'Missing Favorite Studios',
        config: {
          sort: 'DATE',
          direction: 'DESC',
          stashdbFavorites: 'STUDIO',
          tagIds: ['tag-1'],
          tagNames: ['Feature'],
          tagMode: 'AND',
          studioIds: ['studio-9'],
          studioNames: ['Pulse'],
          stashFavoritePerformersOnly: false,
          stashFavoriteStudiosOnly: false,
          stashFavoriteTagsOnly: false,
          libraryAvailability: 'MISSING_FROM_LIBRARY',
          limit: 18,
        },
      }),
    });
    expect(result).toMatchObject({
      source: 'HYBRID',
      config: {
        stashdbFavorites: 'STUDIO',
        libraryAvailability: 'MISSING_FROM_LIBRARY',
      },
    });
  });

  it('updates a custom rail config and metadata', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(buildRail({ id: 'custom-1' }));
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
      source: 'STASHDB',
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

  it('updates a custom Stash rail and keeps source immutable', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildStashRail({
        id: 'custom-stash-1',
        config: {
          sort: 'UPDATED_AT',
          direction: 'ASC',
          titleQuery: 'anthology',
          tagIds: ['tag-1', 'tag-2'],
          tagNames: ['Feature', 'Archive'],
          tagMode: 'AND',
          studioIds: ['studio-1'],
          studioNames: ['Pulse'],
          favoritePerformersOnly: true,
          favoriteStudiosOnly: false,
          favoriteTagsOnly: false,
          limit: 10,
        },
      }),
    );
    updateMock.mockResolvedValue(
      buildStashRail({
        id: 'custom-stash-1',
        title: 'Library A-Z',
        config: {
          sort: 'TITLE',
          direction: 'ASC',
          titleQuery: 'archive',
          tagIds: ['tag-1'],
          tagNames: ['Feature'],
          tagMode: 'OR',
          studioIds: ['studio-3'],
          studioNames: ['North'],
          favoritePerformersOnly: false,
          favoriteStudiosOnly: true,
          favoriteTagsOnly: true,
          limit: 12,
        },
      }),
    );

    const result = await service.updateRail('custom-stash-1', {
      source: 'STASH',
      title: 'Library A-Z',
      subtitle: null,
      enabled: true,
      config: {
        sort: 'TITLE',
        direction: 'ASC',
        titleQuery: 'archive',
        tagIds: ['tag-1'],
        tagNames: ['Feature'],
        tagMode: 'OR',
        studioIds: ['studio-3'],
        studioNames: ['North'],
        favoritePerformersOnly: false,
        favoriteStudiosOnly: true,
        favoriteTagsOnly: true,
        limit: 12,
      },
    });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'custom-stash-1' },
      data: expect.objectContaining({
        title: 'Library A-Z',
        config: {
          sort: 'TITLE',
          direction: 'ASC',
          titleQuery: 'archive',
          tagIds: ['tag-1'],
          tagNames: ['Feature'],
          tagMode: 'OR',
          studioIds: ['studio-3'],
          studioNames: ['North'],
          favoritePerformersOnly: false,
          favoriteStudiosOnly: true,
          favoriteTagsOnly: true,
          limit: 12,
        },
      }),
    });
    expect(result).toMatchObject({
      source: 'STASH',
      config: {
        sort: 'TITLE',
        direction: 'ASC',
        titleQuery: 'archive',
        tagIds: ['tag-1'],
        studioIds: ['studio-3'],
        favoriteStudiosOnly: true,
      },
    });
  });

  it('updates a custom hybrid rail with provider-scoped favorites and availability mode', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildHybridRail({
        id: 'custom-hybrid-1',
        config: {
          sort: 'DATE',
          direction: 'DESC',
          stashdbFavorites: null,
          tagIds: [],
          tagNames: [],
          tagMode: null,
          studioIds: [],
          studioNames: [],
          stashFavoritePerformersOnly: false,
          stashFavoriteStudiosOnly: false,
          stashFavoriteTagsOnly: false,
          libraryAvailability: 'MISSING_FROM_LIBRARY',
          limit: 16,
        },
      }),
    );
    updateMock.mockResolvedValue(
      buildHybridRail({
        id: 'custom-hybrid-1',
        title: 'Already in Library Favorites',
        subtitle: 'Updated subtitle',
        enabled: false,
        config: {
          sort: 'TITLE',
          direction: 'ASC',
          stashdbFavorites: 'PERFORMER',
          tagIds: ['tag-4'],
          tagNames: ['Archive'],
          tagMode: 'OR',
          studioIds: ['studio-8'],
          studioNames: ['North'],
          stashFavoritePerformersOnly: true,
          stashFavoriteStudiosOnly: false,
          stashFavoriteTagsOnly: true,
          libraryAvailability: 'IN_LIBRARY',
          limit: 12,
        },
      }),
    );

    const result = await service.updateRail('custom-hybrid-1', {
      source: 'HYBRID',
      title: 'Already in Library Favorites',
      subtitle: 'Updated subtitle',
      enabled: false,
      config: {
        sort: 'TITLE',
        direction: 'ASC',
        stashdbFavorites: 'PERFORMER',
        tagIds: ['tag-4'],
        tagNames: ['Archive'],
        tagMode: 'OR',
        studioIds: ['studio-8'],
        studioNames: ['North'],
        stashFavoritePerformersOnly: true,
        stashFavoriteStudiosOnly: false,
        stashFavoriteTagsOnly: true,
        libraryAvailability: 'IN_LIBRARY',
        limit: 12,
      },
    });

    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'custom-hybrid-1' },
      data: expect.objectContaining({
        title: 'Already in Library Favorites',
        subtitle: 'Updated subtitle',
        enabled: false,
        config: {
          sort: 'TITLE',
          direction: 'ASC',
          stashdbFavorites: 'PERFORMER',
          tagIds: ['tag-4'],
          tagNames: ['Archive'],
          tagMode: 'OR',
          studioIds: ['studio-8'],
          studioNames: ['North'],
          stashFavoritePerformersOnly: true,
          stashFavoriteStudiosOnly: false,
          stashFavoriteTagsOnly: true,
          libraryAvailability: 'IN_LIBRARY',
          limit: 12,
        },
      }),
    });
    expect(result).toMatchObject({
      source: 'HYBRID',
      config: {
        stashdbFavorites: 'PERFORMER',
        libraryAvailability: 'IN_LIBRARY',
      },
    });
  });

  it('rejects unsupported source-specific config pollution and source switching', async () => {
    upsertMock.mockResolvedValue({});

    await expect(
      service.createRail({
        source: 'STASH',
        title: 'Bad Stash Rail',
        subtitle: null,
        enabled: true,
        config: {
          sort: 'CREATED_AT',
          direction: 'DESC',
          favorites: 'ALL',
          limit: 16,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.createRail({
        source: 'HYBRID',
        title: 'Bad Hybrid Rail',
        subtitle: null,
        enabled: true,
        config: {
          sort: 'DATE',
          direction: 'DESC',
          favorites: 'ALL',
          libraryAvailability: 'IN_LIBRARY',
          limit: 16,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    findUniqueMock.mockResolvedValue(buildRail({ id: 'custom-1' }));

    await expect(
      service.updateRail('custom-1', {
        source: 'STASH',
        title: 'Crossed wires',
        subtitle: null,
        enabled: true,
        config: {
          sort: 'CREATED_AT',
          direction: 'DESC',
          limit: 16,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes a custom rail and reindexes sort order', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildRail({ id: 'custom-1', sortOrder: 1 }),
    );
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
      buildStashRail({
        id: 'built-in-3',
        key: HomeRailKey.RECENTLY_ADDED_LIBRARY,
        kind: HomeRailKind.BUILTIN,
        sortOrder: 3,
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
        source: 'STASHDB',
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
      buildStashRail({
        id: 'built-in-3',
        key: HomeRailKey.RECENTLY_ADDED_LIBRARY,
        kind: HomeRailKind.BUILTIN,
        sortOrder: 3,
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
        { ...rails[3], enabled: true, sortOrder: 3 },
      ]);

    const result = await service.updateRails({
      rails: [
        { id: 'built-in-2', enabled: true },
        { id: 'built-in-1', enabled: false },
        { id: 'custom-1', enabled: true },
        { id: 'built-in-3', enabled: true },
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
    expect(updateMock).toHaveBeenNthCalledWith(4, {
      where: { id: 'built-in-3' },
      data: { enabled: true, sortOrder: 3 },
    });
    expect(result.map((rail) => rail.id)).toEqual([
      'built-in-2',
      'built-in-1',
      'custom-1',
      'built-in-3',
    ]);
  });

  it('rejects duplicate ids in the reorder payload', async () => {
    upsertMock.mockResolvedValue({});
    findManyMock.mockResolvedValue([
      buildRail({
        id: 'built-in-1',
        key: HomeRailKey.FAVORITE_STUDIOS,
        kind: HomeRailKind.BUILTIN,
      }),
      buildRail({
        id: 'built-in-2',
        key: HomeRailKey.FAVORITE_PERFORMERS,
        kind: HomeRailKind.BUILTIN,
      }),
      buildStashRail({
        id: 'built-in-3',
        key: HomeRailKey.RECENTLY_ADDED_LIBRARY,
        kind: HomeRailKind.BUILTIN,
      }),
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

  it('returns projection-backed rail items for the recently added library built-in', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildStashRail({
        id: 'built-in-3',
        key: HomeRailKey.RECENTLY_ADDED_LIBRARY,
        kind: HomeRailKind.BUILTIN,
        title: 'Recently Added to Library',
        config: {
          sort: 'CREATED_AT',
          direction: 'DESC',
          titleQuery: null,
          tagIds: [],
          tagNames: [],
          tagMode: null,
          studioIds: [],
          studioNames: [],
          favoritePerformersOnly: false,
          favoriteStudiosOnly: false,
          favoriteTagsOnly: false,
          limit: 12,
        },
      }),
    );
    libraryGetScenesPreviewMock.mockResolvedValue([
      {
        id: '411',
        title: 'Fresh Library Scene',
        description: null,
        imageUrl: '/api/media/stash/scenes/411/screenshot',
        cardImageUrl: '/api/media/stash/scenes/411/screenshot',
        studioId: 'studio-1',
        studio: 'Archive',
        studioImageUrl: '/api/media/stash/studios/studio-1/logo',
        releaseDate: '2026-03-24',
        duration: 1800,
        type: 'SCENE',
        source: 'STASH',
        viewUrl: 'http://stash.local/scenes/411',
        linkedStashId: null,
      },
    ]);

    const result = await service.getRailContent('built-in-3');

    expect(libraryGetScenesPreviewMock).toHaveBeenCalledWith(
      12,
      'CREATED_AT',
      'DESC',
      undefined,
      [],
      undefined,
      [],
      false,
      false,
      false,
    );
    expect(libraryGetScenesFeedMock).not.toHaveBeenCalled();
    expect(integrationFindUniqueMock).not.toHaveBeenCalled();
    expect(stashGetLocalSceneFeedMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: '411',
          source: 'STASH',
          requestable: false,
          imageUrl: '/api/media/stash/scenes/411/screenshot',
          cardImageUrl: '/api/media/stash/scenes/411/screenshot',
          studioImageUrl: '/api/media/stash/studios/studio-1/logo',
          viewUrl: 'http://stash.local/scenes/411',
          status: { state: 'AVAILABLE' },
        }),
      ],
      message: null,
    });
  });

  it('loads the built-in library rail without requiring live stash integration', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildStashRail({
        id: 'built-in-3',
        key: HomeRailKey.RECENTLY_ADDED_LIBRARY,
        kind: HomeRailKind.BUILTIN,
      }),
    );
    libraryGetScenesPreviewMock.mockResolvedValue([
      {
        id: '512',
        title: 'Indexed Library Scene',
        description: 'Served from the projection.',
        imageUrl: '/api/media/stash/scenes/512/screenshot',
        cardImageUrl: '/api/media/stash/scenes/512/screenshot',
        studioId: 'studio-9',
        studio: 'Signal',
        studioImageUrl: '/api/media/stash/studios/studio-9/logo',
        releaseDate: '2026-03-25',
        duration: 900,
        type: 'SCENE',
        source: 'STASH',
        viewUrl: 'http://stash.local/scenes/512',
        linkedStashId: null,
      },
    ]);

    await expect(service.getRailContent('built-in-3')).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: '512',
          viewUrl: 'http://stash.local/scenes/512',
          status: { state: 'AVAILABLE' },
        }),
      ],
      message: null,
    });
    expect(libraryGetScenesFeedMock).not.toHaveBeenCalled();
    expect(integrationFindUniqueMock).not.toHaveBeenCalled();
    expect(stashGetLocalSceneFeedMock).not.toHaveBeenCalled();
  });

  it('returns a helpful message when the indexed library query fails for a stash rail', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildStashRail({
        id: 'built-in-3',
        key: HomeRailKey.RECENTLY_ADDED_LIBRARY,
        kind: HomeRailKind.BUILTIN,
      }),
    );
    libraryGetScenesPreviewMock.mockRejectedValue(
      new Error('projection timeout'),
    );

    await expect(service.getRailContent('built-in-3')).resolves.toEqual({
      items: [],
      message: 'Unable to load indexed local-library scenes right now.',
    });
    expect(libraryGetScenesFeedMock).not.toHaveBeenCalled();
    expect(integrationFindUniqueMock).not.toHaveBeenCalled();
    expect(stashGetLocalSceneFeedMock).not.toHaveBeenCalled();
  });

  it('loads content for a custom Stash rail through the same local-library path', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildStashRail({
        id: 'custom-stash-2',
        key: null,
        kind: HomeRailKind.CUSTOM,
        title: 'Recently Updated Library',
        config: {
          sort: 'UPDATED_AT',
          direction: 'DESC',
          titleQuery: 'anthology',
          tagIds: ['tag-1'],
          tagNames: ['Feature'],
          tagMode: 'AND',
          studioIds: ['studio-5'],
          studioNames: ['Vault'],
          favoritePerformersOnly: true,
          favoriteStudiosOnly: true,
          favoriteTagsOnly: true,
          limit: 9,
        },
      }),
    );
    libraryGetScenesPreviewMock.mockResolvedValue([]);

    await expect(service.getRailContent('custom-stash-2')).resolves.toEqual({
      items: [],
      message: null,
    });
    expect(libraryGetScenesPreviewMock).toHaveBeenCalledWith(
      9,
      'UPDATED_AT',
      'DESC',
      'anthology',
      ['tag-1'],
      'AND',
      ['studio-5'],
      true,
      true,
      true,
    );
    expect(libraryGetScenesFeedMock).not.toHaveBeenCalled();
    expect(integrationFindUniqueMock).not.toHaveBeenCalled();
    expect(stashGetLocalSceneFeedMock).not.toHaveBeenCalled();
  });

  it('loads hybrid content by discovering on StashDB and matching in-library scenes in Stash', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildHybridRail({
        id: 'custom-hybrid-2',
        title: 'In Library Favorites',
        config: {
          sort: 'DATE',
          direction: 'DESC',
          stashdbFavorites: 'PERFORMER',
          tagIds: ['tag-2'],
          tagNames: ['Archive'],
          tagMode: 'OR',
          studioIds: ['studio-7'],
          studioNames: ['Studio Seven'],
          stashFavoritePerformersOnly: true,
          stashFavoriteStudiosOnly: false,
          stashFavoriteTagsOnly: true,
          libraryAvailability: 'IN_LIBRARY',
          limit: 6,
        },
      }),
    );
    integrationFindUniqueMock.mockImplementation(({ where: { type } }) =>
      Promise.resolve(
        type === 'STASHDB'
          ? {
              type: 'STASHDB',
              enabled: true,
              status: 'CONFIGURED',
              baseUrl: 'http://stashdb.local/graphql',
              apiKey: 'stashdb-secret',
            }
          : {
              type: 'STASH',
              enabled: true,
              status: 'CONFIGURED',
              baseUrl: 'http://stash.local',
              apiKey: 'stash-secret',
            },
      ),
    );
    stashdbGetScenesBySortMock.mockResolvedValue({
      total: 3,
      scenes: [
        {
          id: 'scene-1',
          title: 'One',
          details: null,
          imageUrl: 'https://stashdb.local/scene-1.jpg',
          studioId: 'studio-7',
          studioName: 'Studio Seven',
          studioImageUrl: null,
          releaseDate: '2025-01-01',
          productionDate: null,
          date: null,
          duration: 1200,
        },
        {
          id: 'scene-2',
          title: 'Two',
          details: null,
          imageUrl: 'https://stashdb.local/scene-2.jpg',
          studioId: 'studio-7',
          studioName: 'Studio Seven',
          studioImageUrl: null,
          releaseDate: '2025-01-02',
          productionDate: null,
          date: null,
          duration: 1300,
        },
        {
          id: 'scene-3',
          title: 'Three',
          details: null,
          imageUrl: 'https://stashdb.local/scene-3.jpg',
          studioId: 'studio-7',
          studioName: 'Studio Seven',
          studioImageUrl: null,
          releaseDate: '2025-01-03',
          productionDate: null,
          date: null,
          duration: 1400,
        },
      ],
    });
    stashFindScenesByStashIdMock.mockImplementation((stashId: string) =>
      Promise.resolve(
        stashId === 'scene-2' ? [] : [{ id: `local-${stashId}` }],
      ),
    );

    const result = await service.getRailContent('custom-hybrid-2');

    expect(stashdbGetScenesBySortMock).toHaveBeenCalledWith({
      baseUrl: 'http://stashdb.local/graphql',
      apiKey: 'stashdb-secret',
      page: 1,
      perPage: 12,
      sort: 'DATE',
      direction: 'DESC',
      favorites: 'PERFORMER',
      studioIds: ['studio-7'],
      tagFilter: {
        tagIds: ['tag-2'],
        mode: 'OR',
      },
    });
    expect(stashFindScenesByStashIdMock).toHaveBeenCalledTimes(3);
    expect(stashFindScenesByStashIdMock).toHaveBeenNthCalledWith(
      1,
      'scene-1',
      {
        baseUrl: 'http://stash.local',
        apiKey: 'stash-secret',
      },
      {
        favoritePerformersOnly: true,
        favoriteStudiosOnly: false,
        favoriteTagsOnly: true,
        providerKey: 'STASHDB',
      },
    );
    expect(sceneStatusResolveForScenesMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'scene-1',
          source: 'STASHDB',
          requestable: false,
          status: { state: 'AVAILABLE' },
        }),
        expect.objectContaining({
          id: 'scene-3',
          source: 'STASHDB',
          requestable: false,
          status: { state: 'AVAILABLE' },
        }),
      ],
      message: null,
    });
  });

  it('loads hybrid missing-library content with oversampling and actionable status enrichment', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildHybridRail({
        id: 'custom-hybrid-3',
        title: 'Missing From Library',
        config: {
          sort: 'UPDATED_AT',
          direction: 'ASC',
          stashdbFavorites: 'STUDIO',
          tagIds: [],
          tagNames: [],
          tagMode: null,
          studioIds: [],
          studioNames: [],
          stashFavoritePerformersOnly: false,
          stashFavoriteStudiosOnly: true,
          stashFavoriteTagsOnly: false,
          libraryAvailability: 'MISSING_FROM_LIBRARY',
          limit: 6,
        },
      }),
    );
    integrationFindUniqueMock.mockImplementation(({ where: { type } }) =>
      Promise.resolve(
        type === 'STASHDB'
          ? {
              type: 'STASHDB',
              enabled: true,
              status: 'CONFIGURED',
              baseUrl: 'http://stashdb.local/graphql',
              apiKey: 'stashdb-secret',
            }
          : {
              type: 'STASH',
              enabled: true,
              status: 'CONFIGURED',
              baseUrl: 'http://stash.local',
              apiKey: 'stash-secret',
            },
      ),
    );
    stashdbGetScenesBySortMock
      .mockResolvedValueOnce({
        total: 18,
        scenes: Array.from({ length: 12 }, (_, index) => ({
          id: `scene-${index + 1}`,
          title: `Scene ${index + 1}`,
          details: null,
          imageUrl: `https://stashdb.local/${index + 1}.jpg`,
          studioId: 'studio-1',
          studioName: 'Studio One',
          studioImageUrl: null,
          releaseDate: `2025-01-${String(index + 1).padStart(2, '0')}`,
          productionDate: null,
          date: null,
          duration: 1200,
        })),
      })
      .mockResolvedValueOnce({
        total: 18,
        scenes: [
          {
            id: 'scene-13',
            title: 'Scene 13',
            details: null,
            imageUrl: 'https://stashdb.local/13.jpg',
            studioId: 'studio-1',
            studioName: 'Studio One',
            studioImageUrl: null,
            releaseDate: '2025-01-13',
            productionDate: null,
            date: null,
            duration: 1200,
          },
          {
            id: 'scene-14',
            title: 'Scene 14',
            details: null,
            imageUrl: 'https://stashdb.local/14.jpg',
            studioId: 'studio-1',
            studioName: 'Studio One',
            studioImageUrl: null,
            releaseDate: '2025-01-14',
            productionDate: null,
            date: null,
            duration: 1200,
          },
        ],
      });
    stashFindScenesByStashIdMock.mockImplementation((stashId: string) =>
      Promise.resolve(
        stashId === 'scene-13' || stashId === 'scene-14'
          ? []
          : [{ id: `local-${stashId}` }],
      ),
    );
    sceneStatusResolveForScenesMock.mockResolvedValue(
      new Map([
        ['scene-13', { state: 'FAILED' }],
        ['scene-14', { state: 'DOWNLOADING' }],
      ]),
    );

    const result = await service.getRailContent('custom-hybrid-3');

    expect(stashdbGetScenesBySortMock).toHaveBeenCalledTimes(2);
    expect(stashFindScenesByStashIdMock).toHaveBeenCalledWith(
      'scene-13',
      {
        baseUrl: 'http://stash.local',
        apiKey: 'stash-secret',
      },
      {
        favoritePerformersOnly: false,
        favoriteStudiosOnly: false,
        favoriteTagsOnly: false,
        providerKey: 'STASHDB',
      },
    );
    expect(stashFindScenesByStashIdMock).toHaveBeenCalledWith(
      'scene-14',
      {
        baseUrl: 'http://stash.local',
        apiKey: 'stash-secret',
      },
      {
        favoritePerformersOnly: false,
        favoriteStudiosOnly: false,
        favoriteTagsOnly: false,
        providerKey: 'STASHDB',
      },
    );
    expect(sceneStatusResolveForScenesMock).toHaveBeenCalledWith([
      'scene-13',
      'scene-14',
    ]);
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'scene-13',
          requestable: false,
          status: { state: 'FAILED' },
        }),
        expect.objectContaining({
          id: 'scene-14',
          requestable: false,
          status: { state: 'DOWNLOADING' },
        }),
      ],
      message: null,
    });
  });

  it('returns a helpful message when a hybrid rail is missing StashDB or Stash config', async () => {
    upsertMock.mockResolvedValue({});
    findUniqueMock.mockResolvedValue(
      buildHybridRail({
        id: 'custom-hybrid-4',
      }),
    );
    integrationFindUniqueMock.mockResolvedValue(null);

    await expect(service.getRailContent('custom-hybrid-4')).resolves.toEqual({
      items: [],
      message:
        'Configure and enable your StashDB integration to populate this hybrid rail.',
    });

    integrationFindUniqueMock.mockImplementation(({ where: { type } }) =>
      Promise.resolve(
        type === 'STASHDB'
          ? {
              type: 'STASHDB',
              enabled: true,
              status: 'CONFIGURED',
              baseUrl: 'http://stashdb.local/graphql',
              apiKey: 'stashdb-secret',
            }
          : null,
      ),
    );

    await expect(service.getRailContent('custom-hybrid-4')).resolves.toEqual({
      items: [],
      message:
        'Configure and enable your Stash integration to apply library matching.',
    });
  });

  it('searches indexed library tags and studios through the Home stash endpoints', async () => {
    librarySearchTagsMock.mockResolvedValue([{ id: 'tag-1', name: 'Archive' }]);
    librarySearchStudiosMock.mockResolvedValue([
      { id: 'studio-1', name: 'Pulse' },
    ]);

    await expect(service.searchStashTags('archive')).resolves.toEqual([
      { id: 'tag-1', name: 'Archive', description: null, aliases: [] },
    ]);
    await expect(service.searchStashStudios('pulse')).resolves.toEqual([
      { id: 'studio-1', name: 'Pulse', childStudios: [] },
    ]);
    expect(integrationFindUniqueMock).not.toHaveBeenCalled();
    expect(stashSearchTagsMock).not.toHaveBeenCalled();
    expect(stashSearchStudiosMock).not.toHaveBeenCalled();
  });
});
