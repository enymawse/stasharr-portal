import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';

@Injectable()
export class SessionCookieService {
  readonly cookieName = 'stasharr_session';
  readonly sessionTtlMs = 30 * 24 * 60 * 60 * 1000;
  private readonly sessionSecret: string;
  private readonly secureCookie: boolean;

  constructor() {
    const configuredSecret = process.env.SESSION_SECRET?.trim();
    if (!configuredSecret && process.env.NODE_ENV !== 'test') {
      throw new Error('SESSION_SECRET is required');
    }

    this.sessionSecret = configuredSecret || 'test-session-secret';
    this.secureCookie = parseBoolean(process.env.SESSION_COOKIE_SECURE);
  }

  readSessionId(cookieHeader: string | undefined): string | null {
    const signedValue = this.readCookieValue(cookieHeader);
    if (!signedValue) {
      return null;
    }

    const separatorIndex = signedValue.lastIndexOf('.');
    if (separatorIndex <= 0) {
      return null;
    }

    const sessionId = signedValue.slice(0, separatorIndex);
    const signature = signedValue.slice(separatorIndex + 1);
    const expectedSignature = this.sign(sessionId);

    if (!constantTimeEquals(signature, expectedSignature)) {
      return null;
    }

    return sessionId;
  }

  setSessionCookie(
    response: Response,
    sessionId: string,
    expiresAt: Date,
  ): void {
    response.cookie(this.cookieName, `${sessionId}.${this.sign(sessionId)}`, {
      expires: expiresAt,
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secureCookie,
      path: '/',
    });
  }

  clearSessionCookie(response: Response): void {
    response.clearCookie(this.cookieName, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secureCookie,
      path: '/',
    });
  }

  private sign(value: string): string {
    return createHmac('sha256', this.sessionSecret)
      .update(value)
      .digest('base64url');
  }

  private readCookieValue(cookieHeader: string | undefined): string | null {
    if (!cookieHeader) {
      return null;
    }

    for (const rawPart of cookieHeader.split(';')) {
      const part = rawPart.trim();
      if (!part.startsWith(`${this.cookieName}=`)) {
        continue;
      }

      const encodedValue = part.slice(this.cookieName.length + 1);
      try {
        return decodeURIComponent(encodedValue);
      } catch {
        return encodedValue;
      }
    }

    return null;
  }
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return value === '1' || value.toLowerCase() === 'true';
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
