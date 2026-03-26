export const SCENE_STATUS_VALUES = [
  'NOT_REQUESTED',
  'REQUESTED',
  'DOWNLOADING',
  'IMPORT_PENDING',
  'AVAILABLE',
] as const;

export type SceneStatus = (typeof SCENE_STATUS_VALUES)[number];

export class SceneStatusDto {
  state!: SceneStatus;
}
