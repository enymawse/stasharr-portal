import { PrismaService } from '../prisma/prisma.service';
import { LibrarySceneQueryService } from './library-scene-query.service';
import { LibraryService } from './library.service';

const librarySceneListSelect = {
  stashSceneId: true,
  linkedStashId: true,
  title: true,
  description: true,
  imageUrl: true,
  studioId: true,
  studioName: true,
  studioImageUrl: true,
  performerNames: true,
  releaseDate: true,
  duration: true,
  viewUrl: true,
  localCreatedAt: true,
};

function buildLibraryRow(overrides: Record<string, unknown> = {}) {
  return {
    stashSceneId: '411',
    linkedStashId: 'stash-411',
    linkedCatalogRefs: ['STASHDB|stash-411'],
    title: 'Fresh Local Scene',
    description: 'Already indexed locally.',
    imageUrl: 'http://stash.local/images/411.jpg',
    studioId: 'studio-1',
    studioName: 'Archive',
    studioImageUrl: 'http://stash.local/studios/archive.jpg',
    performerIds: ['performer-1'],
    performerNames: ['Performer One'],
    tagIds: ['tag-1', 'tag-2'],
    tagNames: ['Tag One', 'Tag Two'],
    releaseDate: '2026-03-24',
    duration: 1800,
    viewUrl: 'http://stash.local/scenes/411',
    localCreatedAt: new Date('2026-03-23T00:00:00.000Z'),
    localUpdatedAt: new Date('2026-03-24T00:00:00.000Z'),
    hasFavoritePerformer: false,
    favoriteStudio: false,
    hasFavoriteTag: false,
    lastSyncedAt: new Date('2026-03-30T00:00:00.000Z'),
    createdAt: new Date('2026-03-30T00:00:00.000Z'),
    updatedAt: new Date('2026-03-30T00:00:00.000Z'),
    ...overrides,
  };
}

describe('LibraryService', () => {
  const librarySceneIndexFindManyMock = jest.fn();
  const librarySceneIndexAggregateMock = jest.fn();
  const queryRawMock = jest.fn();

  const prismaService = {
    librarySceneIndex: {
      findMany: librarySceneIndexFindManyMock,
      aggregate: librarySceneIndexAggregateMock,
    },
    $queryRaw: queryRawMock,
  } as unknown as PrismaService;

  let service: LibraryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LibraryService(
      prismaService,
      new LibrarySceneQueryService(prismaService),
    );
    librarySceneIndexFindManyMock.mockResolvedValue([buildLibraryRow()]);
    librarySceneIndexAggregateMock.mockResolvedValue({
      _count: { _all: 3 },
      _max: { lastSyncedAt: new Date('2026-03-30T00:00:00.000Z') },
    });
    queryRawMock.mockResolvedValue([]);
  });

  it('builds the library feed from the local-library projection', async () => {
    const result = await service.getScenesFeed(1, 2);

    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.latestSyncAt).toEqual(new Date('2026-03-30T00:00:00.000Z'));
    expect(result.items).toEqual([
      {
        id: '411',
        activeCatalogSceneId: 'stash-411',
        title: 'Fresh Local Scene',
        description: 'Already indexed locally.',
        imageUrl: '/api/media/stash/scenes/411/screenshot',
        cardImageUrl: '/api/media/stash/scenes/411/screenshot',
        studioId: 'studio-1',
        studio: 'Archive',
        studioImageUrl: '/api/media/stash/studios/studio-1/logo',
        performerNames: ['Performer One'],
        releaseDate: '2026-03-24',
        duration: 1800,
        localCreatedAt: new Date('2026-03-23T00:00:00.000Z'),
        type: 'SCENE',
        source: 'STASH',
        viewUrl: 'http://stash.local/scenes/411',
      },
    ]);
    expect(librarySceneIndexFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: [
          { releaseDate: 'desc' },
          { title: 'asc' },
          { stashSceneId: 'asc' },
        ],
        select: librarySceneListSelect,
        skip: 0,
        take: 2,
      }),
    );
    expect(librarySceneIndexAggregateMock).toHaveBeenCalledWith({
      where: {},
      _count: {
        _all: true,
      },
      _max: {
        lastSyncedAt: true,
      },
    });
  });

  it('loads a preview-sized projection slice without counting the full result set', async () => {
    const result = await service.getScenesPreview(
      12,
      'CREATED_AT',
      'DESC',
      'archive',
      [' tag-1 ', 'tag-1'],
      'AND',
      [' studio-1 ', 'studio-1'],
      true,
      false,
      true,
    );

    expect(result).toEqual([
      {
        id: '411',
        activeCatalogSceneId: 'stash-411',
        title: 'Fresh Local Scene',
        description: 'Already indexed locally.',
        imageUrl: '/api/media/stash/scenes/411/screenshot',
        cardImageUrl: '/api/media/stash/scenes/411/screenshot',
        studioId: 'studio-1',
        studio: 'Archive',
        studioImageUrl: '/api/media/stash/studios/studio-1/logo',
        performerNames: ['Performer One'],
        releaseDate: '2026-03-24',
        duration: 1800,
        localCreatedAt: new Date('2026-03-23T00:00:00.000Z'),
        type: 'SCENE',
        source: 'STASH',
        viewUrl: 'http://stash.local/scenes/411',
      },
    ]);
    expect(librarySceneIndexFindManyMock).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            OR: [
              { title: { contains: 'archive', mode: 'insensitive' } },
              { description: { contains: 'archive', mode: 'insensitive' } },
              { studioName: { contains: 'archive', mode: 'insensitive' } },
            ],
          },
          {
            tagIds: {
              hasEvery: ['tag-1'],
            },
          },
          {
            studioId: {
              in: ['studio-1'],
            },
          },
          { hasFavoritePerformer: true },
          { hasFavoriteTag: true },
        ],
      },
      orderBy: [
        { localCreatedAt: 'desc' },
        { title: 'asc' },
        { stashSceneId: 'asc' },
      ],
      select: librarySceneListSelect,
      take: 12,
    });
    expect(librarySceneIndexAggregateMock).not.toHaveBeenCalled();
  });

  it('does not expose a catalog link id when the projection lacks an active-provider match', async () => {
    librarySceneIndexFindManyMock.mockResolvedValue([
      buildLibraryRow({
        linkedStashId: null,
        linkedCatalogRefs: ['FANSDB|stash-411'],
      }),
    ]);
    librarySceneIndexAggregateMock.mockResolvedValue({
      _count: { _all: 1 },
      _max: { lastSyncedAt: new Date('2026-03-30T00:00:00.000Z') },
    });

    const result = await service.getScenesFeed(1, 1);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: '411',
        activeCatalogSceneId: null,
      }),
    ]);
  });

  it('applies query, tag, studio, and sort filters in the database query', async () => {
    await service.getScenesFeed(
      2,
      10,
      'TITLE',
      'ASC',
      'archive',
      ['tag-1', 'tag-2'],
      'AND',
      ['studio-1', 'studio-2'],
    );

    expect(librarySceneIndexFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { title: { contains: 'archive', mode: 'insensitive' } },
                { description: { contains: 'archive', mode: 'insensitive' } },
                { studioName: { contains: 'archive', mode: 'insensitive' } },
              ],
            },
            {
              tagIds: {
                hasEvery: ['tag-1', 'tag-2'],
              },
            },
            {
              studioId: {
                in: ['studio-1', 'studio-2'],
              },
            },
          ],
        },
        orderBy: [{ title: 'asc' }, { stashSceneId: 'asc' }],
        skip: 10,
        take: 10,
      }),
    );
  });

  it('applies local favorite overlay filters from the library surface', async () => {
    await service.getScenesFeed(
      1,
      24,
      'UPDATED_AT',
      'DESC',
      undefined,
      [],
      'OR',
      [],
      true,
      true,
      false,
    );

    expect(librarySceneIndexFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ hasFavoritePerformer: true }, { favoriteStudio: true }],
        },
      }),
    );
  });

  it('returns indexed tag options from the local-library projection', async () => {
    queryRawMock.mockResolvedValue([
      { id: 'tag-1', name: 'Tag One' },
      { id: 'tag-2', name: 'Tag Two' },
    ]);

    await expect(service.searchTags('tag')).resolves.toEqual([
      { id: 'tag-1', name: 'Tag One' },
      { id: 'tag-2', name: 'Tag Two' },
    ]);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it('prefilters tag option search before unnesting every tag row', async () => {
    await service.searchTags('tag');

    expect(queryRawMock).toHaveBeenCalledTimes(1);

    const query = queryRawMock.mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };

    expect(query.strings.join(' ')).toContain(
      `library_scene_tag_names_search_text("tagNames") ILIKE`,
    );
    expect(query.strings.join(' ')).toContain(
      `CROSS JOIN LATERAL unnest("tagIds", "tagNames")`,
    );
    expect(query.values).toEqual(['%tag%', '%tag%']);
  });

  it('returns indexed studio options from the local-library projection', async () => {
    queryRawMock.mockResolvedValue([{ id: 'studio-1', name: 'Archive' }]);

    await expect(service.searchStudios('arch')).resolves.toEqual([
      { id: 'studio-1', name: 'Archive' },
    ]);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates trimmed tag and studio filters while preserving OR matching', async () => {
    await service.getScenesFeed(
      1,
      24,
      'RELEASE_DATE',
      'DESC',
      undefined,
      [' tag-1 ', 'tag-1', 'tag-2'],
      'OR',
      [' studio-1 ', 'studio-1', 'studio-2'],
    );

    expect(librarySceneIndexFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              tagIds: {
                hasSome: ['tag-1', 'tag-2'],
              },
            },
            {
              studioId: {
                in: ['studio-1', 'studio-2'],
              },
            },
          ],
        },
      }),
    );
  });

  it('skips tag and studio search queries when the query is blank', async () => {
    await expect(service.searchTags('   ')).resolves.toEqual([]);
    await expect(service.searchStudios('')).resolves.toEqual([]);

    expect(queryRawMock).not.toHaveBeenCalled();
  });
});
