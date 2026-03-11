import { BadGatewayException } from '@nestjs/common';
import { WhisparrAdapter } from './whisparr.adapter';

describe('WhisparrAdapter', () => {
  let adapter: WhisparrAdapter;
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
    adapter = new WhisparrAdapter();
  });

  it('returns null for empty result array', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    } as Response);

    await expect(
      adapter.findSceneByStashId('scene-1', {
        baseUrl: 'http://whisparr.local',
      }),
    ).resolves.toBeNull();
  });

  it('maps available=true when hasFile is true', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            stashId: 'scene-1',
            hasFile: true,
          },
        ]),
    } as Response);

    await expect(
      adapter.findSceneByStashId('scene-1', {
        baseUrl: 'http://whisparr.local/base',
        apiKey: 'secret',
      }),
    ).resolves.toEqual({
      stashId: 'scene-1',
      available: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://whisparr.local/base/api/v3/movie?stashId=scene-1',
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Api-Key': 'secret',
        },
      },
    );
  });

  it('returns requested-like match when scene exists but has no file', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            stashId: 'scene-1',
            hasFile: false,
          },
        ]),
    } as Response);

    await expect(
      adapter.findSceneByStashId('scene-1', {
        baseUrl: 'http://whisparr.local',
      }),
    ).resolves.toEqual({
      stashId: 'scene-1',
      available: false,
    });
  });

  it('prefers exact stashId matches and ignores malformed entries', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          { stashId: '', hasFile: true },
          { stashId: 'other-scene', hasFile: true },
          { stashId: 'scene-1', isAvailable: false },
          { stashId: 'scene-1', hasFile: true },
          { hasFile: true },
        ]),
    } as Response);

    await expect(
      adapter.findSceneByStashId('scene-1', {
        baseUrl: 'http://whisparr.local',
      }),
    ).resolves.toEqual({
      stashId: 'scene-1',
      available: true,
    });
  });

  it('throws BadGatewayException for malformed non-array payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ not: 'an array' }),
    } as Response);

    await expect(
      adapter.findSceneByStashId('scene-1', {
        baseUrl: 'http://whisparr.local',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('throws BadGatewayException when fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));

    await expect(
      adapter.findSceneByStashId('scene-1', {
        baseUrl: 'http://whisparr.local',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('builds scene view URL for deep-linking', () => {
    expect(
      adapter.buildSceneViewUrl(
        'http://whisparr.local/base/',
        '019cd3c7-089f-7b87-b064-db980b95df0f',
      ),
    ).toBe(
      'http://whisparr.local/base/movie/019cd3c7-089f-7b87-b064-db980b95df0f',
    );
  });
});
