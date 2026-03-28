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
          studioId: 'studio-1',
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

  it('batches lightweight scene metadata lookups with GraphQL aliases', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            scene_0: {
              id: 'scene-1',
              title: 'Scene 1',
              details: 'Details 1',
              date: '2026-03-01',
              release_date: '2026-03-02',
              production_date: '2026-03-03',
              duration: 640,
              images: [
                {
                  id: 'img-1',
                  url: 'https://scene-1-large.jpg',
                  width: 1920,
                  height: 1080,
                },
              ],
              studio: {
                id: 'studio-1',
                name: 'Studio One',
                images: [
                  {
                    id: 'studio-1-img',
                    url: 'https://studio-1-large.jpg',
                    width: 512,
                    height: 512,
                  },
                ],
              },
            },
            scene_1: {
              id: 'scene-2',
              title: 'Scene 2',
              details: null,
              date: null,
              release_date: null,
              production_date: '2026-04-01',
              duration: 720,
              images: [],
              studio: null,
            },
          },
        }),
    } as Response);

    const result = await adapter.getSceneMetadataByIds(
      ['scene-1', 'scene-2'],
      { baseUrl: 'http://stashdb.local/graphql' },
    );

    expect(result).toEqual([
      {
        id: 'scene-1',
        title: 'Scene 1',
        details: 'Details 1',
        imageUrl: 'https://scene-1-large.jpg',
        studioId: 'studio-1',
        studioName: 'Studio One',
        studioImageUrl: 'https://studio-1-large.jpg',
        releaseDate: '2026-03-02',
        duration: 640,
      },
      {
        id: 'scene-2',
        title: 'Scene 2',
        details: null,
        imageUrl: null,
        studioId: null,
        studioName: null,
        studioImageUrl: null,
        releaseDate: '2026-04-01',
        duration: 720,
      },
    ]);

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string; variables: Record<string, string> };

    expect(requestBody.query).toContain('scene_0: findScene(id: $id0)');
    expect(requestBody.query).toContain('scene_1: findScene(id: $id1)');
    expect(requestBody.query).not.toContain('performers');
    expect(requestBody.query).not.toContain('tags');
    expect(requestBody.query).not.toContain('urls');
    expect(requestBody.variables).toEqual({
      id0: 'scene-1',
      id1: 'scene-2',
    });
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
    expect(requestBody.query).toContain('direction: DESC');
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
    expect(requestBody.query).toContain('direction: DESC');
  });

  it('passes through requested scene direction', async () => {
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

    await adapter.getScenesBySort({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'ASC',
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('direction: ASC');
  });

  it('maps OR tag mode to INCLUDES and sends selected tag ids', async () => {
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

    await adapter.getScenesBySort({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      tagFilter: {
        tagIds: ['tag-1', 'tag-2'],
        mode: 'OR',
      },
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string; variables: { tagIds?: string[] } };

    expect(requestBody.query).toContain('modifier: INCLUDES');
    expect(requestBody.variables.tagIds).toEqual(['tag-1', 'tag-2']);
  });

  it('maps AND tag mode to INCLUDES_ALL', async () => {
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

    await adapter.getScenesBySort({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      tagFilter: {
        tagIds: ['tag-9'],
        mode: 'AND',
      },
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('modifier: INCLUDES_ALL');
  });

  it('omits tags filter when no tag ids are provided', async () => {
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

    await adapter.getScenesBySort({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      tagFilter: {
        tagIds: [],
        mode: 'OR',
      },
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).not.toContain('tags:');
  });

  it('omits favorites filter when favorites is unset', async () => {
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

    await adapter.getScenesBySort({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 25,
      sort: 'DATE',
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).not.toContain('favorites:');
  });

  it('includes favorites: ALL when requested', async () => {
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

    await adapter.getScenesBySort({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      favorites: 'ALL',
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('favorites: ALL');
  });

  it('includes favorites: PERFORMER when requested', async () => {
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

    await adapter.getScenesBySort({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      favorites: 'PERFORMER',
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('favorites: PERFORMER');
  });

  it('includes favorites: STUDIO when requested', async () => {
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

    await adapter.getScenesBySort({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      favorites: 'STUDIO',
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('favorites: STUDIO');
  });

  it('searches tags and normalizes result shape', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryTags: {
              tags: [
                {
                  id: 'tag-1',
                  name: 'Natural',
                  description: 'Natural scenes',
                  aliases: ['Nat', 42],
                },
                {
                  id: 12,
                  name: 'Invalid',
                  description: null,
                  aliases: [],
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.searchTags({
        baseUrl: 'http://stashdb.local/graphql',
        query: 'nat',
      }),
    ).resolves.toEqual([
      {
        id: 'tag-1',
        name: 'Natural',
        description: 'Natural scenes',
        aliases: ['Nat'],
      },
    ]);

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string; variables: { name?: string } };

    expect(requestBody.query).toContain('queryTags');
    expect(requestBody.variables.name).toBe('nat');
  });

  it('queries performers with default NAME sort', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryPerformers: {
              count: 1,
              performers: [
                {
                  id: 'p-1',
                  name: 'Performer One',
                  gender: 'FEMALE',
                  scene_count: 12,
                  is_favorite: true,
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.getPerformersFeed({
        baseUrl: 'http://stashdb.local/graphql',
        page: 1,
        perPage: 50,
      }),
    ).resolves.toEqual({
      total: 1,
      performers: [
        {
          id: 'p-1',
          name: 'Performer One',
          gender: 'FEMALE',
          sceneCount: 12,
          isFavorite: true,
          imageUrl: null,
        },
      ],
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('sort: NAME');
    expect(requestBody.query).toContain('direction: ASC');
    expect(requestBody.query).toContain('images');
    expect(requestBody.query).not.toContain('is_favorite: true');
  });

  it('forwards performer feed filters and non-default sort', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryPerformers: {
              count: 0,
              performers: [],
            },
          },
        }),
    } as Response);

    await adapter.getPerformersFeed({
      baseUrl: 'http://stashdb.local/graphql',
      page: 2,
      perPage: 50,
      name: 'aj',
      gender: 'FEMALE',
      sort: 'SCENE_COUNT',
      favoritesOnly: true,
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string; variables: { name?: string } };

    expect(requestBody.query).toContain('name: $name');
    expect(requestBody.query).toContain('gender: FEMALE');
    expect(requestBody.query).toContain('sort: SCENE_COUNT');
    expect(requestBody.query).toContain('direction: ASC');
    expect(requestBody.query).toContain('is_favorite: true');
    expect(requestBody.variables.name).toBe('aj');
  });

  it('passes through requested performer feed direction', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryPerformers: {
              count: 0,
              performers: [],
            },
          },
        }),
    } as Response);

    await adapter.getPerformersFeed({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 50,
      direction: 'DESC',
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('direction: DESC');
  });

  it('omits is_favorite filter when favoritesOnly is false', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryPerformers: {
              count: 0,
              performers: [],
            },
          },
        }),
    } as Response);

    await adapter.getPerformersFeed({
      baseUrl: 'http://stashdb.local/graphql',
      page: 1,
      perPage: 50,
      favoritesOnly: false,
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).not.toContain('is_favorite: true');
  });

  it('normalizes findPerformer response for performer details', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findPerformer: {
              id: 'p-1',
              name: 'Performer One',
              disambiguation: 'v2',
              aliases: ['Alias'],
              gender: 'FEMALE',
              birth_date: '1990-01-01',
              death_date: null,
              age: 35,
              ethnicity: 'Ethnicity',
              country: 'US',
              eye_color: 'Brown',
              hair_color: 'Black',
              height: '170cm',
              cup_size: 'C',
              band_size: 34,
              waist_size: 24,
              hip_size: 35,
              breast_type: 'NATURAL',
              career_start_year: 2010,
              career_end_year: null,
              deleted: false,
              merged_ids: ['p-old'],
              merged_into_id: null,
              is_favorite: true,
              created: '2024-01-01',
              updated: '2025-01-01',
              images: [
                { id: 'img-1', url: 'https://small.jpg', width: 320, height: 240 },
                { id: 'img-2', url: 'https://large.jpg', width: 1024, height: 768 },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.getPerformerById('p-1', { baseUrl: 'http://stashdb.local/graphql' }),
    ).resolves.toMatchObject({
      id: 'p-1',
      name: 'Performer One',
      isFavorite: true,
      imageUrl: 'https://large.jpg',
      images: [{ id: 'img-1' }, { id: 'img-2' }],
    });
  });

  it('normalizes findStudio response for studio details', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findStudio: {
              id: 'studio-1',
              name: 'Studio One',
              aliases: ['Alias One'],
              deleted: false,
              is_favorite: true,
              created: '2024-01-01',
              updated: '2024-02-01',
              urls: [
                {
                  url: 'https://stashdb.org/studios/studio-1',
                  type: 'DETAILS',
                  site: {
                    name: 'StashDB',
                    url: 'https://stashdb.org',
                    icon: 'https://stashdb.org/icon.png',
                  },
                },
              ],
              parent: {
                id: 'parent-1',
                name: 'Parent Studio',
                aliases: ['Parent Alias'],
                is_favorite: false,
                urls: [
                  {
                    url: 'https://stashdb.org/studios/parent-1',
                    type: 'DETAILS',
                    site: {
                      name: 'StashDB',
                      url: 'https://stashdb.org',
                      icon: null,
                    },
                  },
                ],
              },
              child_studios: [
                {
                  id: 'child-1',
                  name: 'Child Studio',
                  aliases: [],
                  deleted: false,
                  is_favorite: false,
                  created: '2024-03-01',
                  updated: '2024-03-02',
                  urls: [],
                  images: [
                    {
                      id: 'child-img-1',
                      url: 'https://child-small.jpg',
                      width: 128,
                      height: 128,
                    },
                    {
                      id: 'child-img-2',
                      url: 'https://child-large.jpg',
                      width: 512,
                      height: 256,
                    },
                  ],
                },
              ],
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
                  width: 720,
                  height: 400,
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.getStudioById('studio-1', {
        baseUrl: 'http://stashdb.local/graphql',
      }),
    ).resolves.toEqual({
      id: 'studio-1',
      name: 'Studio One',
      aliases: ['Alias One'],
      deleted: false,
      isFavorite: true,
      createdAt: '2024-01-01',
      updatedAt: '2024-02-01',
      imageUrl: 'https://studio-large.jpg',
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
          width: 720,
          height: 400,
        },
      ],
      urls: [
        {
          url: 'https://stashdb.org/studios/studio-1',
          type: 'DETAILS',
          siteName: 'StashDB',
          siteUrl: 'https://stashdb.org',
          siteIcon: 'https://stashdb.org/icon.png',
        },
      ],
      parentStudio: {
        id: 'parent-1',
        name: 'Parent Studio',
        aliases: ['Parent Alias'],
        isFavorite: false,
        urls: [
          {
            url: 'https://stashdb.org/studios/parent-1',
            type: 'DETAILS',
            siteName: 'StashDB',
            siteUrl: 'https://stashdb.org',
            siteIcon: null,
          },
        ],
      },
      childStudios: [
        {
          id: 'child-1',
          name: 'Child Studio',
          aliases: [],
          deleted: false,
          isFavorite: false,
          createdAt: '2024-03-01',
          updatedAt: '2024-03-02',
          imageUrl: 'https://child-large.jpg',
        },
      ],
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string; variables: { id: string } };

    expect(requestBody.query).toContain('findStudio');
    expect(requestBody.variables.id).toBe('studio-1');
  });

  it('throws NotFoundException when findStudio returns null', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            findStudio: null,
          },
        }),
    } as Response);

    await expect(
      adapter.getStudioById('studio-404', {
        baseUrl: 'http://stashdb.local/graphql',
      }),
    ).rejects.toThrow('Studio studio-404 not found in StashDB.');
  });

  it('normalizes studio search with child studios', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryStudios: {
              studios: [
                {
                  id: 'studio-1',
                  name: 'Network',
                  child_studios: [
                    { id: 'studio-1a', name: 'Child A' },
                    { id: 'studio-1b', name: 'Child B' },
                  ],
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.searchStudios('net', { baseUrl: 'http://stashdb.local/graphql' }),
    ).resolves.toEqual([
      {
        id: 'studio-1',
        name: 'Network',
        childStudios: [
          { id: 'studio-1a', name: 'Child A' },
          { id: 'studio-1b', name: 'Child B' },
        ],
      },
    ]);
  });

  it('queries studios feed with sort/name/favorites and normalizes image + children', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            queryStudios: {
              count: 2,
              studios: [
                {
                  id: 'studio-1',
                  name: 'Studio One',
                  is_favorite: true,
                  parent: {
                    id: 'parent-1',
                    name: 'Parent Studio',
                  },
                  images: [
                    {
                      id: 'studio-img-small',
                      url: 'https://studio-small.jpg',
                      width: 64,
                      height: 64,
                    },
                    {
                      id: 'studio-img-large',
                      url: 'https://studio-large.jpg',
                      width: 480,
                      height: 320,
                    },
                  ],
                  child_studios: [
                    { id: 'child-1', name: 'Child One' },
                    { id: 'child-2', name: 'Child Two' },
                  ],
                },
                {
                  id: 'parent-1',
                  name: 'Parent Studio',
                  is_favorite: false,
                  parent: null,
                  images: [],
                  child_studios: [{ id: 'studio-1', name: 'Studio One' }],
                },
              ],
            },
          },
        }),
    } as Response);

    await expect(
      adapter.getStudiosFeed({
        baseUrl: 'http://stashdb.local/graphql',
        page: 2,
        perPage: 25,
        sort: 'UPDATED_AT',
        direction: 'DESC',
        name: 'studio',
        favoritesOnly: true,
      }),
    ).resolves.toEqual({
      total: 2,
      studios: [
        {
          id: 'studio-1',
          name: 'Studio One',
          isFavorite: true,
          imageUrl: 'https://studio-large.jpg',
          parentStudio: { id: 'parent-1', name: 'Parent Studio' },
          childStudios: [
            { id: 'child-1', name: 'Child One' },
            { id: 'child-2', name: 'Child Two' },
          ],
        },
        {
          id: 'parent-1',
          name: 'Parent Studio',
          isFavorite: false,
          imageUrl: null,
          parentStudio: null,
          childStudios: [{ id: 'studio-1', name: 'Studio One' }],
        },
      ],
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string; variables: { page: number; perPage: number; name?: string } };

    expect(requestBody.query).toContain('queryStudios');
    expect(requestBody.query).toContain('sort: UPDATED_AT');
    expect(requestBody.query).toContain('direction: DESC');
    expect(requestBody.query).toContain('parent {');
    expect(requestBody.query).toContain('is_favorite: true');
    expect(requestBody.variables).toEqual({
      page: 2,
      perPage: 25,
      name: 'studio',
    });
  });

  it('builds performer-scoped scenes query with optional filters', async () => {
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

    await adapter.getScenesForPerformer({
      baseUrl: 'http://stashdb.local/graphql',
      performerId: 'p-1',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      studioIds: ['studio-1'],
      tagIds: ['tag-1', 'tag-2'],
      onlyFavoriteStudios: true,
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string; variables: Record<string, unknown> };

    expect(requestBody.query).toContain('performers: { value: $performerId, modifier: INCLUDES }');
    expect(requestBody.query).toContain('direction: DESC');
    expect(requestBody.query).toContain('studios: { value: $studioIds, modifier: INCLUDES }');
    expect(requestBody.query).toContain('tags: { value: $tagIds, modifier: INCLUDES }');
    expect(requestBody.query).toContain('favorites: STUDIO');
    expect(requestBody.variables.performerId).toEqual(['p-1']);
    expect(requestBody.variables.studioIds).toEqual(['studio-1']);
    expect(requestBody.variables.tagIds).toEqual(['tag-1', 'tag-2']);
  });

  it('omits optional performer-scoped scene filters when unset', async () => {
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

    await adapter.getScenesForPerformer({
      baseUrl: 'http://stashdb.local/graphql',
      performerId: 'p-1',
      page: 1,
      perPage: 25,
      sort: 'DATE',
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).not.toContain('studios:');
    expect(requestBody.query).not.toContain('tags:');
    expect(requestBody.query).not.toContain('favorites: STUDIO');
    expect(requestBody.query).toContain('direction: DESC');
  });

  it('passes through requested performer-scenes direction', async () => {
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

    await adapter.getScenesForPerformer({
      baseUrl: 'http://stashdb.local/graphql',
      performerId: 'p-1',
      page: 1,
      perPage: 25,
      sort: 'DATE',
      direction: 'ASC',
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as { query: string };

    expect(requestBody.query).toContain('direction: ASC');
  });

  it('favorites performer successfully', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            favoritePerformer: true,
          },
        }),
    } as Response);

    await expect(
      adapter.favoritePerformer('performer-1', true, {
        baseUrl: 'http://stashdb.local/graphql',
      }),
    ).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });
  });

  it('treats performer duplicate favorite as idempotent success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: null,
          errors: [
            {
              message:
                'ERROR: duplicate key value violates unique constraint "performer_favorites_unique_idx" (SQLSTATE 23505)',
              path: ['favoritePerformer'],
            },
          ],
        }),
    } as Response);

    await expect(
      adapter.favoritePerformer('performer-1', true, {
        baseUrl: 'http://stashdb.local/graphql',
      }),
    ).resolves.toEqual({
      favorited: true,
      alreadyFavorited: true,
    });
  });

  it('favorites studio successfully', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            favoriteStudio: true,
          },
        }),
    } as Response);

    await expect(
      adapter.favoriteStudio('studio-1', true, {
        baseUrl: 'http://stashdb.local/graphql',
      }),
    ).resolves.toEqual({
      favorited: true,
      alreadyFavorited: false,
    });
  });

  it('treats studio duplicate favorite as idempotent success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: null,
          errors: [
            {
              message:
                'ERROR: duplicate key value violates unique constraint "studio_favorites_unique_idx" (SQLSTATE 23505)',
              path: ['favoriteStudio'],
            },
          ],
        }),
    } as Response);

    await expect(
      adapter.favoriteStudio('studio-1', true, {
        baseUrl: 'http://stashdb.local/graphql',
      }),
    ).resolves.toEqual({
      favorited: true,
      alreadyFavorited: true,
    });
  });

  it('unfavorites performer successfully', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            favoritePerformer: true,
          },
        }),
    } as Response);

    await expect(
      adapter.favoritePerformer('performer-1', false, {
        baseUrl: 'http://stashdb.local/graphql',
      }),
    ).resolves.toEqual({
      favorited: false,
      alreadyFavorited: false,
    });
  });

  it('unfavorites studio successfully', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            favoriteStudio: true,
          },
        }),
    } as Response);

    await expect(
      adapter.favoriteStudio('studio-1', false, {
        baseUrl: 'http://stashdb.local/graphql',
      }),
    ).resolves.toEqual({
      favorited: false,
      alreadyFavorited: false,
    });
  });
});
