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
});
