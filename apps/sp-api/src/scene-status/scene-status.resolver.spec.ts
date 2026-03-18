import { resolveSceneStatus } from './scene-status.resolver';

describe('resolveSceneStatus', () => {
  it('returns DOWNLOADING when queue state is in-flight even if hasFile is true', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: true,
        },
        queueItems: [
          {
            movieId: 101,
            trackedDownloadState: 'Downloading',
            trackedDownloadStatus: 'Warning',
          },
        ],
      }),
    ).toEqual({ state: 'DOWNLOADING' });
  });

  it('returns DOWNLOADING for ImportPending and Importing states', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          {
            movieId: 101,
            trackedDownloadState: 'ImportPending',
            trackedDownloadStatus: null,
          },
        ],
      }),
    ).toEqual({ state: 'DOWNLOADING' });

    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          {
            movieId: 101,
            trackedDownloadState: 'Importing',
            trackedDownloadStatus: 'Ok',
          },
        ],
      }),
    ).toEqual({ state: 'DOWNLOADING' });
  });

  it('treats lowercase queue states as DOWNLOADING', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          {
            movieId: 101,
            trackedDownloadState: 'downloading',
            trackedDownloadStatus: 'ok',
          },
        ],
      }),
    ).toEqual({ state: 'DOWNLOADING' });
  });

  it('returns NOT_REQUESTED when no movie exists', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: null,
        queueItems: [],
      }),
    ).toEqual({ state: 'NOT_REQUESTED' });
  });

  it('returns AVAILABLE when movie has file and no in-flight queue state', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: true,
        },
        queueItems: [
          {
            movieId: 101,
            trackedDownloadState: 'Imported',
            trackedDownloadStatus: 'Ok',
          },
        ],
      }),
    ).toEqual({ state: 'AVAILABLE' });
  });

  it('returns MISSING when movie exists without file and no in-flight queue state', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          {
            movieId: 101,
            trackedDownloadState: 'Failed',
            trackedDownloadStatus: 'Error',
          },
          {
            movieId: 101,
            trackedDownloadState: 'Ignored',
            trackedDownloadStatus: null,
          },
        ],
      }),
    ).toEqual({ state: 'MISSING' });
  });

  it('ignores queue entries for other movie ids', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          {
            movieId: 999,
            trackedDownloadState: 'Downloading',
            trackedDownloadStatus: null,
          },
        ],
      }),
    ).toEqual({ state: 'MISSING' });
  });
});
