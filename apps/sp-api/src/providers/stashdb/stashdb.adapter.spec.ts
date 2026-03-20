import { StashdbAdapter } from './stashdb.adapter';

describe('StashdbAdapter', () => {
  let adapter: StashdbAdapter;
  let originalFetch: typeof fetch;
  const fetchMock = jest.fn();

  beforeAll(() => {
    originalFetch = global.fetch;
    Object.assign(global, { fetch: fetchMock });
  });

  afterAll(() => {
    Object.assign(global, { fetch: originalFetch });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new StashdbAdapter();
  });

  it('requests studio images and normalizes studio badge URL from the widest image', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryScenes: {
              count: 1,
              scenes: [
                {
                  id: 'scene-1',
                  title: 'Scene 1',
                  details: 'Details',
                  date: '2026-03-01',
                  release_date: '2026-03-02',
                  production_date: '2026-03-03',
                  duration: 640,
                  images: [
                    {
                      id: 'img-1',
                      url: 'https://scene-small.jpg',
                      width: 320,
                      height: 180,
                    },
                    {
                      id: 'img-2',
                      url: 'https://scene-large.jpg',
                      width: 1920,
                      height: 1080,
                    },
                  ],
                  studio: {
                    id: 'studio-1',
                    name: 'Studio Name',
                    images: [
                      {
                        id: 'studio-img-1',
                        url: 'https://studio-small.jpg',
                        width: 64,
                        height: 64,
                      },
                      {
                        id: 'studio-img-2',
                        url: 'https://studio-large.jpg',
                        width: 512,
                        height: 512,
                      },
                    ],
                  },
                },
              ],
            },
          },
        }),
    } as Response);

    const result = await adapter.getTrendingScenes({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 25,
    });

    expect(result).toEqual({
      total: 1,
      scenes: [
        {
          id: 'scene-1',
          title: 'Scene 1',
          details: 'Details',
          imageUrl: 'https://scene-large.jpg',
          studioName: 'Studio Name',
          studioImageUrl: 'https://studio-large.jpg',
          date: '2026-03-01',
          releaseDate: '2026-03-02',
          productionDate: '2026-03-03',
          duration: 640,
        },
      ],
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('studio');
    expect(requestBody.query).toContain('images');
  });

  it('returns normalized studioImageUrl for scene details from studio images', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findScene: {
              id: 'scene-1',
              title: 'Scene 1',
              details: 'Details',
              date: '2026-03-01',
              release_date: '2026-03-02',
              production_date: '2026-03-03',
              duration: 640,
              images: [
                {
                  id: 'img-1',
                  url: 'https://scene-large.jpg',
                  width: 1920,
                  height: 1080,
                },
              ],
              tags: [],
              urls: [],
              performers: [],
              studio: {
                id: 'studio-1',
                name: 'Studio Name',
                is_favorite: false,
                images: [
                  {
                    id: 'studio-img-1',
                    url: 'https://studio-small.jpg',
                    width: 180,
                    height: 120,
                  },
                  {
                    id: 'studio-img-2',
                    url: 'https://studio-wide.png',
                    width: 860,
                    height: 180,
                  },
                ],
              },
            },
          },
        }),
    } as Response);

    const result = await adapter.getSceneById('scene-1', {
      baseUrl: 'http://stashdb.local/graphql',
    });

    expect(result).toMatchObject({
      id: 'scene-1',
      studioName: 'Studio Name',
      studioImageUrl: 'https://studio-wide.png',
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('findScene');
    expect(requestBody.query).toContain('studio');
    expect(requestBody.query).toContain('images');
  });

  it('requests date-sorted scenes for the scenes feed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryScenes: {
              count: 0,
              scenes: [],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.getScenesSortedByDate({
        baseUrl: 'http://stashdb.local/graphql',
        page: 1,
        perPage: 25,
      }),
    ).resolves.toEqual({
      total: 0,
      scenes: [],
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('sort: DATE');
  });

  it('passes through selected sort value for scene feeds', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryScenes: {
              count: 0,
              scenes: [],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.getScenesBySort({
        baseUrl: 'http://stashdb.local/graphql',
        page: 1,
        perPage: 25,
        sort: 'UPDATED_AT',
      }),
    ).resolves.toEqual({
      total: 0,
      scenes: [],
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('sort: UPDATED_AT');
  });
});
