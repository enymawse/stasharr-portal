import { SceneStatus } from '../../core/api/discover.types';

type SceneStatusLike = Pick<SceneStatus, 'state'>;

export function sceneStatusBadgeLabel(status: SceneStatusLike): string {
  switch (status.state) {
    case 'REQUESTED':
      return 'Requested';
    case 'DOWNLOADING':
      return 'Downloading';
    case 'IMPORT_PENDING':
      return 'Awaiting Import';
    case 'AVAILABLE':
      return 'In Library';
    case 'FAILED':
      return 'Failed';
    case 'NOT_REQUESTED':
    default:
      return 'Not Requested';
  }
}

export function sceneStatusBadgeModifier(status: SceneStatusLike): string {
  switch (status.state) {
    case 'REQUESTED':
      return 'requested';
    case 'DOWNLOADING':
      return 'downloading';
    case 'IMPORT_PENDING':
      return 'import-pending';
    case 'AVAILABLE':
      return 'available';
    case 'FAILED':
      return 'failed';
    case 'NOT_REQUESTED':
    default:
      return 'not-requested';
  }
}

export function sceneStatusIconClass(status: SceneStatusLike): string {
  switch (status.state) {
    case 'REQUESTED':
      return 'pi pi-bookmark';
    case 'DOWNLOADING':
      return 'pi pi-spinner pi-spin';
    case 'IMPORT_PENDING':
      return 'pi pi-upload';
    case 'AVAILABLE':
      return 'pi pi-check-circle';
    case 'FAILED':
      return 'pi pi-exclamation-circle';
    case 'NOT_REQUESTED':
    default:
      return 'pi pi-circle';
  }
}

export function sceneStatusIconVisible(status: SceneStatusLike): boolean {
  return status.state !== 'NOT_REQUESTED';
}
