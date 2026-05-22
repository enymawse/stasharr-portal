import type { LogLevel } from '@nestjs/common';

const VALID_LOG_LEVELS = new Set<LogLevel>([
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
  'fatal',
]);

const PRODUCTION_LOG_LEVELS: LogLevel[] = ['error', 'warn', 'log', 'fatal'];
const DEVELOPMENT_LOG_LEVELS: LogLevel[] = [
  'error',
  'warn',
  'log',
  'debug',
  'verbose',
  'fatal',
];

export function resolveNestLogLevels(
  env: NodeJS.ProcessEnv = process.env,
): LogLevel[] {
  const configured = env.STASHARR_LOG_LEVELS?.trim();
  if (configured) {
    const levels = configured
      .split(',')
      .map((level) => level.trim())
      .filter((level): level is LogLevel =>
        VALID_LOG_LEVELS.has(level as LogLevel),
      );

    if (levels.length > 0) {
      return levels;
    }
  }

  return env.NODE_ENV === 'production'
    ? PRODUCTION_LOG_LEVELS
    : DEVELOPMENT_LOG_LEVELS;
}
