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
    expect(body.variables).toEqual({
      filter: {
        page: 1,
        per_page: 16,
        sort: 'created_at',
        direction: 'DESC',
      },
    });
    expect(String(body.query)).toContain('findScenes(filter: $filter)');
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
});
