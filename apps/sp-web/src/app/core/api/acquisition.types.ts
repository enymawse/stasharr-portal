import { DiscoverItem, SceneStatusState } from './discover.types';

export type AcquisitionLifecycleState = Exclude<SceneStatusState, 'NOT_REQUESTED' | 'AVAILABLE'>;
export type AcquisitionLifecycleFilter = 'ANY' | AcquisitionLifecycleState;

export interface AcquisitionCountsByLifecycle {
  REQUESTED: number;
  DOWNLOADING: number;
  IMPORT_PENDING: number;
  FAILED: number;
}

export interface AcquisitionSceneItem extends DiscoverItem {
  whisparrViewUrl: string | null;
}

export interface AcquisitionScenesResponse {
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  countsByLifecycle: AcquisitionCountsByLifecycle;
  items: AcquisitionSceneItem[];
}
