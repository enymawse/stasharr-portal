import { resolveSceneStatus } from './scene-status.resolver';

describe('resolveSceneStatus', () => {
  it('returns AVAILABLE when Stash already has a linked scene copy', () => {
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
        stashAvailable: true,
        requested: true,
      }),
    ).toEqual({ state: 'AVAILABLE' });
  });

  it('returns DOWNLOADING for an active download queue state', () => {
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
            trackedDownloadState: 'Downloading',
            trackedDownloadStatus: 'Ok',
          },
        ],
        stashAvailable: false,
        requested: true,
      }),
    ).toEqual({ state: 'DOWNLOADING' });
  });

  it('returns IMPORT_PENDING for ImportPending and Importing queue states', () => {
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
        stashAvailable: false,
        requested: true,
      }),
    ).toEqual({ state: 'IMPORT_PENDING' });

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
        stashAvailable: false,
        requested: true,
      }),
    ).toEqual({ state: 'IMPORT_PENDING' });
  });

  it('returns IMPORT_PENDING when Whisparr has the file but Stash does not', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: true,
        },
        queueItems: [],
        stashAvailable: false,
        requested: true,
      }),
    ).toEqual({ state: 'IMPORT_PENDING' });
  });

  it('returns REQUESTED when Whisparr knows the scene but acquisition has not started', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [],
        stashAvailable: false,
        requested: false,
      }),
    ).toEqual({ state: 'REQUESTED' });
  });

  it('returns REQUESTED when only fallback request evidence exists', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: null,
        queueItems: [],
        stashAvailable: false,
        requested: true,
      }),
    ).toEqual({ state: 'REQUESTED' });
  });

  it('returns NOT_REQUESTED when no system knows the scene', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: null,
        queueItems: [],
        stashAvailable: false,
        requested: false,
      }),
    ).toEqual({ state: 'NOT_REQUESTED' });
  });
});
