export const SCENE_STATUS_VALUES = [
  'NOT_REQUESTED',
  'REQUESTED',
  'DOWNLOADING',
  'IMPORT_PENDING',
  'AVAILABLE',
  'FAILED',
] as const;

export type SceneStatus = (typeof SCENE_STATUS_VALUES)[number];

export const SCENE_REQUESTABLE_STATUS_VALUES = [
  'NOT_REQUESTED',
] as const;

export function isSceneStatusRequestable(status: {
  state: SceneStatus;
}): boolean {
  return status.state === 'NOT_REQUESTED';
}

export class SceneStatusDto {
  state!: SceneStatus;
}
