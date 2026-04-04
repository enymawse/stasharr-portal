import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

interface AttemptState {
  failures: number;
  blockedUntil: number | null;
}

@Injectable()
export class LoginAttemptService {
  private static readonly MAX_FAILURES = 5;
  private static readonly COOLDOWN_MS = 60_000;
  private readonly attempts = new Map<string, AttemptState>();

  assertAllowed(key: string): void {
    const state = this.attempts.get(key);
    if (!state) {
      return;
    }

    if (!state.blockedUntil) {
      return;
    }

    if (state.blockedUntil <= Date.now()) {
      this.attempts.delete(key);
      return;
    }

    throw new HttpException(
      'Too many login attempts. Wait a minute and try again.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const current = this.attempts.get(key);

    if (
      !current ||
      (current.blockedUntil !== null && current.blockedUntil <= now)
    ) {
      this.attempts.set(key, { failures: 1, blockedUntil: null });
      return;
    }

    const failures = current.failures + 1;
    this.attempts.set(key, {
      failures,
      blockedUntil:
        failures >= LoginAttemptService.MAX_FAILURES
          ? now + LoginAttemptService.COOLDOWN_MS
          : null,
    });
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
