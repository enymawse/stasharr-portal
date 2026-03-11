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
});
