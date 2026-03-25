import { BadGatewayException } from '@nestjs/common';
import { StashAdapter } from './stash.adapter';

describe('StashAdapter', () => {
  let adapter: StashAdapter;
  let originalFetch: typeof fetch;
  const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();

  beforeAll(() => {
    originalFetch = global.fetch;
    Object.assign(global, { fetch: fetchMock });
  });

  afterAll(() => {
    Object.assign(global, { fetch: originalFetch });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new StashAdapter();
  });

  it('returns empty list when there are no matching scenes', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScenes: {
              count: 0,
              scenes: [],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.findScenesByStashId('stash-1', {
        baseUrl: 'http://stash.local',
      }),
    ).resolves.toEqual([]);
  });

  it('returns normalized scene links sorted by highest resolution', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScenes: {
              count: 2,
              scenes: [
                {
                  id: '3030',
                  files: [{ width: 1920, height: 1080 }],
                },
                {
                  id: '3027',
                  files: [{ width: 3840, height: 2160 }],
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.findScenesByStashId('stash-1', {
        baseUrl: 'http://stash.local/base/',
        apiKey: 'secret',
      }),
    ).resolves.toEqual([
      {
        id: '3027',
        width: 3840,
        height: 2160,
        viewUrl: 'http://stash.local/base/scenes/3027',
        label: '2160p',
      },
      {
        id: '3030',
        width: 1920,
        height: 1080,
        viewUrl: 'http://stash.local/base/scenes/3030',
        label: '1080p',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://stash.local/base/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ApiKey: 'secret',
        },
      }),
    );

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(typeof init?.body).toBe('string');
  });

  it('falls back to Scene #id label when file dimensions are missing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScenes: {
              count: 1,
              scenes: [
                {
                  id: '3027',
                  files: [{ width: null, height: null }, {}],
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.findScenesByStashId('stash-1', {
        baseUrl: 'http://stash.local',
      }),
    ).resolves.toEqual([
      {
        id: '3027',
        width: null,
        height: null,
        viewUrl: 'http://stash.local/scenes/3027',
        label: 'Scene #3027',
      },
    ]);
  });

  it('ignores malformed scene entries', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScenes: {
              count: 3,
              scenes: [
                { id: 1, files: [] },
                { id: '', files: [] },
                { id: '3040', files: [{ width: 1280, height: 720 }] },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.findScenesByStashId('stash-1', {
        baseUrl: 'http://stash.local',
      }),
    ).resolves.toEqual([
      {
        id: '3040',
        width: 1280,
        height: 720,
        viewUrl: 'http://stash.local/scenes/3040',
        label: '720p',
      },
    ]);
  });

  it('throws on malformed GraphQL payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: {} }),
    } as Response);

    await expect(
      adapter.findScenesByStashId('stash-1', {
        baseUrl: 'http://stash.local',
      }),
    ).resolves.toEqual([]);
  });

  it('throws BadGatewayException when provider request fails', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));

    await expect(
      adapter.findScenesByStashId('stash-1', {
        baseUrl: 'http://stash.local',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('queries local scenes using created_at descending for recent library rails', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScenes: {
              count: 1,
              scenes: [
                {
                  id: '411',
                  title: 'Fresh Library Scene',
                  details: 'Recently scanned into the local library.',
                  date: '2026-03-24',
                  paths: { screenshot: 'http://stash.local/images/411.jpg' },
                  studio: {
                    id: 'studio-1',
                    name: 'Archive',
                    image_path: 'http://stash.local/studios/archive.jpg',
                  },
                  files: [
                    { width: 1920, height: 1080, duration: 1800 },
                  ],
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.getLocalSceneFeed(
        {
          baseUrl: 'http://stash.local',
          apiKey: 'secret',
        },
        {
          page: 1,
          perPage: 16,
          sort: 'CREATED_AT',
          direction: 'DESC',
        },
      ),
    ).resolves.toEqual({
      total: 1,
      items: [
        {
          id: '411',
          title: 'Fresh Library Scene',
          description: 'Recently scanned into the local library.',
          imageUrl: 'http://stash.local/images/411.jpg',
          cardImageUrl: 'http://stash.local/images/411.jpg',
          studioId: 'studio-1',
          studio: 'Archive',
          studioImageUrl: 'http://stash.local/studios/archive.jpg',
          releaseDate: '2026-03-24',
          duration: 1800,
          viewUrl: 'http://stash.local/scenes/411',
        },
      ],
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(typeof init?.body).toBe('string');
    const body = JSON.parse(String(init?.body));
    expect(body.variables).toMatchObject({
      filter: {
        page: 1,
        per_page: 16,
        sort: 'created_at',
        direction: 'DESC',
      },
    });
    expect(body.variables.sceneFilter).toBeUndefined();
    expect(String(body.query)).toContain('findScenes(filter: $filter, scene_filter: $sceneFilter)');
    expect(String(body.query)).toContain('paths');
  });

  it('supports updated_at and title local scene feed sorts', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScenes: {
              count: 0,
              scenes: [],
            },
          },
        }),
    } as Response);

    await adapter.getLocalSceneFeed(
      { baseUrl: 'http://stash.local' },
      { page: 1, perPage: 8, sort: 'UPDATED_AT', direction: 'ASC' },
    );

    let [, init] = fetchMock.mock.calls[0] ?? [];
    let body = JSON.parse(String(init?.body));
    expect(body.variables.filter).toMatchObject({
      sort: 'updated_at',
      direction: 'ASC',
    });

    fetchMock.mockClear();

    await adapter.getLocalSceneFeed(
      { baseUrl: 'http://stash.local' },
      { page: 2, perPage: 8, sort: 'TITLE', direction: 'DESC' },
    );

    [, init] = fetchMock.mock.calls[0] ?? [];
    body = JSON.parse(String(init?.body));
    expect(body.variables.filter).toMatchObject({
      page: 2,
      per_page: 8,
      sort: 'title',
      direction: 'DESC',
    });
  });

  it('adds title, tag, studio, and favorite filters to the local scene feed query', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScenes: {
              count: 0,
              scenes: [],
            },
          },
        }),
    } as Response);

    await adapter.getLocalSceneFeed(
      { baseUrl: 'http://stash.local' },
      {
        page: 1,
        perPage: 10,
        sort: 'UPDATED_AT',
        direction: 'ASC',
        titleQuery: ' anthology ',
        tagIds: ['tag-1', 'tag-1', 'tag-2'],
        tagMode: 'AND',
        studioIds: ['studio-1', 'studio-1', 'studio-2'],
        favoritePerformersOnly: true,
        favoriteStudiosOnly: true,
      },
    );

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.variables.sceneFilter).toEqual({
      title: {
        value: 'anthology',
        modifier: 'INCLUDES',
      },
      tags: {
        value: ['tag-1', 'tag-2'],
        modifier: 'INCLUDES_ALL',
      },
      studios: {
        value: ['studio-1', 'studio-2'],
        modifier: 'INCLUDES',
      },
      performers_filter: {
        filter_favorites: true,
      },
      studios_filter: {
        favorite: true,
      },
    });
  });

  it('maps stash tag mode OR to INCLUDES and omits scene_filter when unset', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScenes: {
              count: 0,
              scenes: [],
            },
          },
        }),
    } as Response);

    await adapter.getLocalSceneFeed(
      { baseUrl: 'http://stash.local' },
      {
        page: 1,
        perPage: 5,
        sort: 'CREATED_AT',
        direction: 'DESC',
      },
    );

    let [, init] = fetchMock.mock.calls[0] ?? [];
    let body = JSON.parse(String(init?.body));
    expect(body.variables).toMatchObject({
      filter: {
        page: 1,
        per_page: 5,
        sort: 'created_at',
        direction: 'DESC',
      },
    });
    expect(body.variables.sceneFilter).toBeUndefined();

    fetchMock.mockClear();

    await adapter.getLocalSceneFeed(
      { baseUrl: 'http://stash.local' },
      {
        page: 1,
        perPage: 5,
        sort: 'CREATED_AT',
        direction: 'DESC',
        tagIds: ['tag-1'],
        tagMode: 'OR',
      },
    );

    [, init] = fetchMock.mock.calls[0] ?? [];
    body = JSON.parse(String(init?.body));
    expect(body.variables.sceneFilter).toEqual({
      tags: {
        value: ['tag-1'],
        modifier: 'INCLUDES',
      },
    });
  });

  it('ignores malformed local scene entries and falls back cleanly when fields are missing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScenes: {
              count: 3,
              scenes: [
                { id: '' },
                { id: 9 },
                {
                  id: '812',
                  title: null,
                  details: '',
                  date: null,
                  files: [{ duration: null }, { width: 1280, height: 720 }],
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.getLocalSceneFeed(
        { baseUrl: 'http://stash.local/base' },
        { page: 1, perPage: 12, sort: 'CREATED_AT', direction: 'DESC' },
      ),
    ).resolves.toEqual({
      total: 3,
      items: [
        {
          id: '812',
          title: 'Scene #812',
          description: null,
          imageUrl: null,
          cardImageUrl: null,
          studioId: null,
          studio: null,
          studioImageUrl: null,
          releaseDate: null,
          duration: null,
          viewUrl: 'http://stash.local/base/scenes/812',
        },
      ],
    });
  });

  it('opens a protected scene screenshot with the configured ApiKey header', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              findScene: {
                id: '411',
                paths: {
                  screenshot: 'http://stash.local/images/411.jpg',
                },
              },
            },
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'image/jpeg',
          'cache-control': 'public, max-age=300',
          'content-length': '12',
        }),
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      } as Response);

    const result = await adapter.openSceneScreenshot('411', {
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });

    expect(result).toMatchObject({
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=300',
      contentLength: '3',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://stash.local/images/411.jpg',
      { headers: { ApiKey: 'secret' } },
    );
  });

  it('opens a protected studio logo and rejects cross-origin asset urls', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              findStudio: {
                id: 'studio-1',
                image_path: 'http://stash.local/studios/archive.jpg',
              },
            },
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: () => Promise.resolve(new Uint8Array([4, 5, 6]).buffer),
      } as Response);

    await expect(
      adapter.openStudioLogo('studio-1', {
        baseUrl: 'http://stash.local/base',
        apiKey: null,
      }),
    ).resolves.toMatchObject({
      contentType: 'image/png',
    });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findStudio: {
              id: 'studio-1',
              image_path: 'http://evil.example/logo.png',
            },
          },
        }),
    } as Response);

    await expect(
      adapter.openStudioLogo('studio-1', {
        baseUrl: 'http://stash.local',
        apiKey: 'secret',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('returns null for missing protected assets or invalid ids', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              findScene: {
                id: '411',
                paths: {
                  screenshot: 'http://stash.local/images/411.jpg',
                },
              },
            },
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        body: null,
      } as Response);

    await expect(
      adapter.openSceneScreenshot('411', {
        baseUrl: 'http://stash.local',
      }),
    ).resolves.toBeNull();

    fetchMock.mockClear();

    await expect(
      adapter.openStudioLogo('../bad-id', {
        baseUrl: 'http://stash.local',
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes stash local tag search results', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findTags: {
              tags: [
                { id: '2', name: 'Archive' },
                { id: '1', name: ' Anthology ' },
                { id: '', name: 'Bad' },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.searchTags('archive', { baseUrl: 'http://stash.local' }),
    ).resolves.toEqual([
      { id: '1', name: 'Anthology' },
      { id: '2', name: 'Archive' },
    ]);
  });

  it('normalizes stash local studio search results into parent groups', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findStudios: {
              studios: [
                {
                  id: 'network-1',
                  name: 'North Network',
                  child_studios: [
                    { id: 'child-2', name: 'Bravo' },
                    { id: 'child-1', name: 'Alpha' },
                  ],
                },
                {
                  id: 'child-3',
                  name: 'Gamma',
                  parent_studio: { id: 'network-2', name: 'South Network' },
                },
                {
                  id: 'network-2',
                  name: 'South Network',
                  child_studios: [{ id: 'child-4', name: 'Delta' }],
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.searchStudios('north', { baseUrl: 'http://stash.local' }),
    ).resolves.toEqual([
      {
        id: 'network-1',
        name: 'North Network',
        childStudios: [
          { id: 'child-1', name: 'Alpha' },
          { id: 'child-2', name: 'Bravo' },
        ],
      },
      {
        id: 'network-2',
        name: 'South Network',
        childStudios: [
          { id: 'child-4', name: 'Delta' },
          { id: 'child-3', name: 'Gamma' },
        ],
      },
    ]);
  });
});
