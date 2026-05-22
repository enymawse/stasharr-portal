import { resolveNestLogLevels } from './log-levels';

describe('resolveNestLogLevels', () => {
  it('suppresses debug logging by default in production', () => {
    expect(resolveNestLogLevels({ NODE_ENV: 'production' })).toEqual([
      'error',
      'warn',
      'log',
      'fatal',
    ]);
  });

  it('keeps debug logging enabled outside production', () => {
    expect(resolveNestLogLevels({ NODE_ENV: 'development' })).toEqual([
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
      'fatal',
    ]);
  });

  it('allows explicit log-level override', () => {
    expect(
      resolveNestLogLevels({
        NODE_ENV: 'production',
        STASHARR_LOG_LEVELS: 'error,warn,log,debug',
      }),
    ).toEqual(['error', 'warn', 'log', 'debug']);
  });
});
