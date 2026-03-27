import { describe, expect, it } from 'vitest';
import { isSceneStatusRequestable } from './discover.types';

describe('isSceneStatusRequestable', () => {
  it('returns true for actionable retry states', () => {
    expect(isSceneStatusRequestable({ state: 'NOT_REQUESTED' })).toBe(true);
    expect(isSceneStatusRequestable({ state: 'FAILED' })).toBe(true);
  });

  it('returns false for non-actionable lifecycle states', () => {
    expect(isSceneStatusRequestable({ state: 'REQUESTED' })).toBe(false);
    expect(isSceneStatusRequestable({ state: 'DOWNLOADING' })).toBe(false);
    expect(isSceneStatusRequestable({ state: 'IMPORT_PENDING' })).toBe(false);
    expect(isSceneStatusRequestable({ state: 'AVAILABLE' })).toBe(false);
  });
});
