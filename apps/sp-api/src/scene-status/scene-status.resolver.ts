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

const DOWNLOADING_STATES = new Set([
  'downloading',
  'importpending',
  'importing',
]);

export function resolveSceneStatus(input: {
  stashId: string;
  movie: WhisparrMovieLookup | null;
  queueItems: WhisparrQueueSnapshotItem[];
}): SceneStatusDto {
  const { movie, queueItems } = input;

  if (movie) {
    const hasActiveQueueItem = queueItems.some(
      (item) =>
        item.movieId === movie.movieId &&
        item.trackedDownloadState !== null &&
        DOWNLOADING_STATES.has(item.trackedDownloadState.trim().toLowerCase()),
    );

    if (hasActiveQueueItem) {
      return { state: 'DOWNLOADING' };
    }
  }

  if (!movie) {
    return { state: 'NOT_REQUESTED' };
  }

  if (movie.hasFile) {
    return { state: 'AVAILABLE' };
  }

  return { state: 'MISSING' };
}
