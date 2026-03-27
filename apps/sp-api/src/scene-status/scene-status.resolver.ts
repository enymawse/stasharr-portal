import { RequestStatus } from '@prisma/client';
import { SceneStatusDto } from './dto/scene-status.dto';

export interface WhisparrMovieLookup {
  movieId: number;
  stashId: string;
  hasFile: boolean;
}

export interface WhisparrQueueSnapshotItem {
  movieId: number;
  status: string | null;
  trackedDownloadState: string | null;
  trackedDownloadStatus: string | null;
  errorMessage: string | null;
}

const FAILED_QUEUE_STATUSES = new Set(['failed', 'warning', 'paused']);
const DOWNLOADING_QUEUE_STATUS = 'downloading';
const COMPLETED_QUEUE_STATUS = 'completed';
const QUEUED_QUEUE_STATUS = 'queued';
const IMPORT_PENDING_STATES = new Set(['importpending', 'importing']);
const REQUESTED_FALLBACK_STATUSES = new Set<RequestStatus>([
  RequestStatus.REQUESTED,
  RequestStatus.PROCESSING,
  RequestStatus.AVAILABLE,
]);

export function resolveSceneStatus(input: {
  stashId: string;
  movie: WhisparrMovieLookup | null;
  queueItems: WhisparrQueueSnapshotItem[];
  stashAvailable: boolean;
  fallbackRequestStatus: RequestStatus | null;
}): SceneStatusDto {
  const { movie, queueItems, stashAvailable, fallbackRequestStatus } = input;

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

  if (fallbackRequestStatus === RequestStatus.FAILED) {
    return { state: 'FAILED' };
  }

  if (
    fallbackRequestStatus !== null &&
    REQUESTED_FALLBACK_STATUSES.has(fallbackRequestStatus)
  ) {
    return { state: 'REQUESTED' };
  }

  return { state: 'NOT_REQUESTED' };
}

function resolveQueueLifecycleState(
  movieId: number,
  queueItems: WhisparrQueueSnapshotItem[],
): SceneStatusDto['state'] | null {
  let hasRequestedState = false;
  let hasDownloadingState = false;
  let hasImportPendingState = false;

  for (const item of queueItems) {
    if (item.movieId !== movieId || item.status === null) {
      continue;
    }

    const normalizedStatus = item.status.trim().toLowerCase();

    if (FAILED_QUEUE_STATUSES.has(normalizedStatus)) {
      return 'FAILED';
    }

    if (normalizedStatus === COMPLETED_QUEUE_STATUS) {
      hasImportPendingState = true;
      continue;
    }

    if (normalizedStatus === QUEUED_QUEUE_STATUS) {
      hasRequestedState = true;
      continue;
    }

    if (normalizedStatus !== DOWNLOADING_QUEUE_STATUS) {
      continue;
    }

    const normalizedDownloadState = item.trackedDownloadState
      ?.trim()
      .toLowerCase();

    // Queue status is the primary operational signal. Download state only
    // refines a healthy "downloading" item into import-related phases.
    if (
      normalizedDownloadState &&
      IMPORT_PENDING_STATES.has(normalizedDownloadState)
    ) {
      hasImportPendingState = true;
      continue;
    }

    hasDownloadingState = true;
  }

  if (hasImportPendingState) {
    return 'IMPORT_PENDING';
  }

  if (hasDownloadingState) {
    return 'DOWNLOADING';
  }

  if (hasRequestedState) {
    return 'REQUESTED';
  }

  return null;
}
