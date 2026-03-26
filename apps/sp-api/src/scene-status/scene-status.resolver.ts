import { SceneStatusDto } from './dto/scene-status.dto';

export interface WhisparrMovieLookup {
  movieId: number;
  stashId: string;
  hasFile: boolean;
}

export interface WhisparrQueueSnapshotItem {
  movieId: number;
  trackedDownloadState: string | null;
  trackedDownloadStatus: string | null;
}

const DOWNLOADING_STATES = new Set(['downloading']);
const IMPORT_PENDING_STATES = new Set(['importpending', 'importing']);

export function resolveSceneStatus(input: {
  stashId: string;
  movie: WhisparrMovieLookup | null;
  queueItems: WhisparrQueueSnapshotItem[];
  stashAvailable: boolean;
  requested: boolean;
}): SceneStatusDto {
  const { movie, queueItems, requested, stashAvailable } = input;

  if (stashAvailable) {
    return { state: 'AVAILABLE' };
  }

  if (movie) {
    const queueState = resolveQueueLifecycleState(movie.movieId, queueItems);

    if (queueState) {
      return { state: queueState };
    }

    if (movie.hasFile) {
      return { state: 'IMPORT_PENDING' };
    }

    return { state: 'REQUESTED' };
  }

  return requested ? { state: 'REQUESTED' } : { state: 'NOT_REQUESTED' };
}

function resolveQueueLifecycleState(
  movieId: number,
  queueItems: WhisparrQueueSnapshotItem[],
): SceneStatusDto['state'] | null {
  let hasDownloadingState = false;

  for (const item of queueItems) {
    if (item.movieId !== movieId || item.trackedDownloadState === null) {
      continue;
    }

    const normalizedState = item.trackedDownloadState.trim().toLowerCase();
    if (IMPORT_PENDING_STATES.has(normalizedState)) {
      return 'IMPORT_PENDING';
    }

    if (DOWNLOADING_STATES.has(normalizedState)) {
      hasDownloadingState = true;
    }
  }

  if (hasDownloadingState) {
    return 'DOWNLOADING';
  }

  return null;
}
