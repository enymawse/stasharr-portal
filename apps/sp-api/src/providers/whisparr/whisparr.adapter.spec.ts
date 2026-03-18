import { BadGatewayException, Logger } from '@nestjs/common';
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

  describe('findMovieByStashId', () => {
    it('returns null for empty result array', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toBeNull();
    });

    it('normalizes movie lookup payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              id: 42,
              stashId: 'scene-1',
              hasFile: true,
            },
          ]),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local/base',
          apiKey: 'secret',
        }),
      ).resolves.toEqual({
        movieId: 42,
        stashId: 'scene-1',
        hasFile: true,
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

    it('ignores malformed entries', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: null, stashId: 'scene-1', hasFile: true },
            { id: 1, hasFile: true },
            { id: 2, stashId: 'other-scene', hasFile: true },
            { id: 3, stashId: 'scene-1', hasFile: false },
          ]),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toEqual({
        movieId: 3,
        stashId: 'scene-1',
        hasFile: false,
      });
    });

    it('throws and logs for multiple movie matches', async () => {
      const loggerWarnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: 1, stashId: 'scene-1', hasFile: false },
            { id: 2, stashId: 'scene-1', hasFile: true },
          ]),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);

      expect(loggerWarnSpy).toHaveBeenCalled();
      loggerWarnSpy.mockRestore();
    });

    it('throws BadGatewayException for malformed non-array payload', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ not: 'an array' }),
      } as Response);

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('throws BadGatewayException when fetch fails', async () => {
      fetchMock.mockRejectedValue(new Error('network failure'));

      await expect(
        adapter.findMovieByStashId('scene-1', {
          baseUrl: 'http://whisparr.local',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('getQueueSnapshot', () => {
    it('normalizes queue payload with records wrapper and filters malformed entries', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            page: 1,
            pageSize: 10,
            records: [
              {
                movieId: 100,
                trackedDownloadState: 'downloading',
                trackedDownloadStatus: 'ok',
              },
              {
                movie: { id: 101 },
                trackedDownloadState: 'ImportPending',
                trackedDownloadStatus: 'Warning',
              },
              {
                movie: {},
                trackedDownloadState: 'Downloading',
              },
              {
                trackedDownloadState: 'Downloading',
              },
            ],
            totalRecords: 4,
          }),
      } as Response);

      await expect(
        adapter.getQueueSnapshot({
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toEqual([
        {
          movieId: 100,
          trackedDownloadState: 'downloading',
          trackedDownloadStatus: 'ok',
        },
        {
          movieId: 101,
          trackedDownloadState: 'ImportPending',
          trackedDownloadStatus: 'Warning',
        },
      ]);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://whisparr.local/api/v3/queue?page=1&pageSize=50',
        expect.any(Object),
      );
    });

    it('pages through queue until totalRecords is collected', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              page: 1,
              pageSize: 50,
              totalRecords: 3,
              records: [
                {
                  movieId: 200,
                  trackedDownloadState: 'downloading',
                  trackedDownloadStatus: 'ok',
                },
                {
                  movieId: 201,
                  trackedDownloadState: 'Importing',
                  trackedDownloadStatus: 'ok',
                },
              ],
            }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              page: 2,
              pageSize: 50,
              totalRecords: 3,
              records: [
                {
                  movieId: 202,
                  trackedDownloadState: 'ImportPending',
                  trackedDownloadStatus: 'ok',
                },
              ],
            }),
        } as Response);

      await expect(
        adapter.getQueueSnapshot({
          baseUrl: 'http://whisparr.local',
        }),
      ).resolves.toEqual([
        {
          movieId: 200,
          trackedDownloadState: 'downloading',
          trackedDownloadStatus: 'ok',
        },
        {
          movieId: 201,
          trackedDownloadState: 'Importing',
          trackedDownloadStatus: 'ok',
        },
        {
          movieId: 202,
          trackedDownloadState: 'ImportPending',
          trackedDownloadStatus: 'ok',
        },
      ]);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'http://whisparr.local/api/v3/queue?page=1&pageSize=50',
        expect.any(Object),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'http://whisparr.local/api/v3/queue?page=2&pageSize=50',
        expect.any(Object),
      );
    });
  });

  it('builds scene view URL for deep-linking', () => {
    expect(adapter.buildSceneViewUrl('http://whisparr.local/base/', 1234)).toBe(
      'http://whisparr.local/base/movie/1234',
    );
  });
});
