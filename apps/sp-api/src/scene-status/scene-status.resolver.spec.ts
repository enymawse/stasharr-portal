import { RequestStatus } from '@prisma/client';
import { resolveSceneStatus } from './scene-status.resolver';

describe('resolveSceneStatus', () => {
  const queueItem = (
    overrides: Partial<{
      movieId: number;
      status: string | null;
      trackedDownloadState: string | null;
      trackedDownloadStatus: string | null;
      errorMessage: string | null;
    }> = {},
  ) => ({
    movieId: 101,
    status: 'downloading',
    trackedDownloadState: 'Downloading',
    trackedDownloadStatus: 'Ok',
    errorMessage: null,
    ...overrides,
  });

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
          queueItem({
            status: 'warning',
            trackedDownloadStatus: 'Warning',
            errorMessage: 'The download is stalled with no connections',
          }),
        ],
        stashAvailable: true,
        fallbackRequestStatus: RequestStatus.FAILED,
      }),
    ).toEqual({ state: 'AVAILABLE' });
  });

  it('returns DOWNLOADING for a healthy active download queue state', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          queueItem(),
        ],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.FAILED,
      }),
    ).toEqual({ state: 'DOWNLOADING' });
  });

  it('returns IMPORT_PENDING for downloading queue items in import-related states', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          queueItem({
            trackedDownloadState: 'ImportPending',
            trackedDownloadStatus: null,
          }),
        ],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.FAILED,
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
          queueItem({
            trackedDownloadState: 'Importing',
          }),
        ],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.FAILED,
      }),
    ).toEqual({ state: 'IMPORT_PENDING' });
  });

  it('returns FAILED for warning, failed, and paused queue statuses', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          queueItem({
            status: 'warning',
            trackedDownloadState: 'Downloading',
            errorMessage: 'The download is stalled with no connections',
          }),
        ],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.REQUESTED,
      }),
    ).toEqual({ state: 'FAILED' });

    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          queueItem({
            status: 'failed',
          }),
        ],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.REQUESTED,
      }),
    ).toEqual({ state: 'FAILED' });

    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          queueItem({
            status: 'paused',
          }),
        ],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.REQUESTED,
      }),
    ).toEqual({ state: 'FAILED' });
  });

  it('returns REQUESTED for queued queue items', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          queueItem({
            status: 'queued',
            trackedDownloadState: null,
            trackedDownloadStatus: null,
          }),
        ],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.FAILED,
      }),
    ).toEqual({ state: 'REQUESTED' });
  });

  it('returns IMPORT_PENDING for completed queue items', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: {
          movieId: 101,
          stashId: 'scene-1',
          hasFile: false,
        },
        queueItems: [
          queueItem({
            status: 'completed',
            trackedDownloadState: null,
            trackedDownloadStatus: null,
          }),
        ],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.FAILED,
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
        fallbackRequestStatus: RequestStatus.REQUESTED,
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
        fallbackRequestStatus: RequestStatus.FAILED,
      }),
    ).toEqual({ state: 'REQUESTED' });
  });

  it('returns REQUESTED when fallback request evidence exists without live provider state', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: null,
        queueItems: [],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.REQUESTED,
      }),
    ).toEqual({ state: 'REQUESTED' });

    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: null,
        queueItems: [],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.AVAILABLE,
      }),
    ).toEqual({ state: 'REQUESTED' });
  });

  it('returns FAILED when the last fallback request failed and no stronger live state exists', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: null,
        queueItems: [],
        stashAvailable: false,
        fallbackRequestStatus: RequestStatus.FAILED,
      }),
    ).toEqual({ state: 'FAILED' });
  });

  it('returns NOT_REQUESTED when no system knows the scene', () => {
    expect(
      resolveSceneStatus({
        stashId: 'scene-1',
        movie: null,
        queueItems: [],
        stashAvailable: false,
        fallbackRequestStatus: null,
      }),
    ).toEqual({ state: 'NOT_REQUESTED' });
  });
});
