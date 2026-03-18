export const SCENE_STATUS_VALUES = [
  'NOT_REQUESTED',
  'DOWNLOADING',
  'AVAILABLE',
  'MISSING',
] as const;

export type SceneStatus = (typeof SCENE_STATUS_VALUES)[number];

export class SceneStatusDto {
  state!: SceneStatus;
}
