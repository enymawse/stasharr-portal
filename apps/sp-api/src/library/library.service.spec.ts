import { PrismaService } from '../prisma/prisma.service';
import { LibraryService } from './library.service';

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
  const librarySceneIndexCountMock = jest.fn();
  const queryRawMock = jest.fn();

  const prismaService = {
    librarySceneIndex: {
      findMany: librarySceneIndexFindManyMock,
      count: librarySceneIndexCountMock,
    },
    $queryRaw: queryRawMock,
  } as unknown as PrismaService;

  let service: LibraryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LibraryService(prismaService);
    librarySceneIndexFindManyMock.mockResolvedValue([buildLibraryRow()]);
    librarySceneIndexCountMock.mockResolvedValue(3);
    queryRawMock.mockResolvedValue([]);
  });

  it('builds the library feed from the local-library projection', async () => {
    const result = await service.getScenesFeed(1, 2);

    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
    expect(result.items).toEqual([
      {
        id: '411',
        linkedStashId: 'stash-411',
        title: 'Fresh Local Scene',
        description: 'Already indexed locally.',
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
        skip: 0,
        take: 2,
      }),
    );
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

  it('returns indexed studio options from the local-library projection', async () => {
    queryRawMock.mockResolvedValue([{ id: 'studio-1', name: 'Archive' }]);

    await expect(service.searchStudios('arch')).resolves.toEqual([
      { id: 'studio-1', name: 'Archive' },
    ]);
    expect(queryRawMock).toHaveBeenCalledTimes(1);
  });
});
