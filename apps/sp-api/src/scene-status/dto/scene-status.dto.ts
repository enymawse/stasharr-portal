export const SCENE_STATUS_VALUES = [
  'UNREQUESTED',
  'REQUESTED',
  'PROCESSING',
  'AVAILABLE',
  'FAILED',
] as const;

export type SceneStatus = (typeof SCENE_STATUS_VALUES)[number];

export class SceneStatusDto {
  state!: SceneStatus;
}
