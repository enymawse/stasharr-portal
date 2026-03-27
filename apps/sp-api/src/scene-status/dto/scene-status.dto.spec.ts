import { isSceneStatusRequestable } from './scene-status.dto';

describe('isSceneStatusRequestable', () => {
  it('returns true only for NOT_REQUESTED scenes', () => {
    expect(isSceneStatusRequestable({ state: 'NOT_REQUESTED' })).toBe(true);
    expect(isSceneStatusRequestable({ state: 'FAILED' })).toBe(false);
    expect(isSceneStatusRequestable({ state: 'REQUESTED' })).toBe(false);
    expect(isSceneStatusRequestable({ state: 'DOWNLOADING' })).toBe(false);
    expect(isSceneStatusRequestable({ state: 'IMPORT_PENDING' })).toBe(false);
    expect(isSceneStatusRequestable({ state: 'AVAILABLE' })).toBe(false);
  });
});
