/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await, @typescript-eslint/unbound-method */

import * as argon2 from 'argon2';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { LoginAttemptService } from './login-attempt.service';
import { SessionCookieService } from './session-cookie.service';

interface AdminUserRecord {
  id: string;
  username: string;
  normalizedUsername: string;
  passwordHash: string;
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

interface AdminSessionRecord {
  id: string;
  userId: string;
  sessionVersion: number;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

describe('AuthService', () => {
  let adminUsers: AdminUserRecord[];
  let adminSessions: AdminSessionRecord[];
  let prisma: PrismaService;
  let sessionCookieService: jest.Mocked<SessionCookieService>;
  let loginAttemptService: jest.Mocked<LoginAttemptService>;
  let service: AuthService;

  beforeEach(() => {
    adminUsers = [];
    adminSessions = [];

    prisma = createPrismaMock();
    sessionCookieService = {
      cookieName: 'stasharr_session',
      sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
      readSessionId: jest.fn().mockReturnValue(null),
      setSessionCookie: jest.fn(),
      clearSessionCookie: jest.fn(),
    } as unknown as jest.Mocked<SessionCookieService>;
    loginAttemptService = {
      assertAllowed: jest.fn(),
      recordFailure: jest.fn(),
      clear: jest.fn(),
    } as unknown as jest.Mocked<LoginAttemptService>;

    service = new AuthService(
      prisma,
      sessionCookieService,
      loginAttemptService,
    );
  });

  it('allows bootstrap only when no admin exists and stores a password hash', async () => {
    const request = createRequest();
    const response = createResponse();

    const status = await service.bootstrapAdmin(
      {
        username: 'LocalAdmin',
        password: 'this-is-a-strong-password',
      },
      request,
      response,
    );

    expect(status).toEqual({
      bootstrapRequired: false,
      authenticated: true,
      username: 'LocalAdmin',
    });
    expect(adminUsers).toHaveLength(1);
    expect(adminUsers[0]?.passwordHash).not.toBe('this-is-a-strong-password');
    await expect(
      argon2.verify(adminUsers[0].passwordHash, 'this-is-a-strong-password'),
    ).resolves.toBe(true);
    expect(sessionCookieService.setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it('blocks bootstrap once an admin account already exists', async () => {
    adminUsers.push(
      await createAdminUser('existing-admin', 'already-present-password'),
    );

    await expect(
      service.bootstrapAdmin(
        {
          username: 'AnotherAdmin',
          password: 'another-strong-password',
        },
        createRequest(),
        createResponse(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('logs in successfully with the correct password and creates a session', async () => {
    adminUsers.push(
      await createAdminUser('local-admin', 'correct-password-123'),
    );

    const status = await service.login(
      {
        username: 'Local-Admin',
        password: 'correct-password-123',
      },
      createRequest(),
      createResponse(),
    );

    expect(status).toEqual({
      bootstrapRequired: false,
      authenticated: true,
      username: 'local-admin',
    });
    expect(loginAttemptService.clear).toHaveBeenCalledTimes(2);
    expect(adminSessions).toHaveLength(1);
    expect(sessionCookieService.setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it('fails login with a generic error when the password is incorrect', async () => {
    adminUsers.push(
      await createAdminUser('local-admin', 'correct-password-123'),
    );

    await expect(
      service.login(
        {
          username: 'local-admin',
          password: 'wrong-password',
        },
        createRequest(),
        createResponse(),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(loginAttemptService.recordFailure).toHaveBeenCalledTimes(2);
    expect(loginAttemptService.clear).not.toHaveBeenCalled();
    expect(adminSessions).toHaveLength(0);
  });

  it('changes the password, removes other sessions, and invalidates the old password', async () => {
    const adminUser = await createAdminUser('local-admin', 'old-password-123');
    adminUsers.push(adminUser);

    const currentSession = createAdminSession(
      adminUser.id,
      adminUser.sessionVersion,
      'session-1',
    );
    const oldSession = createAdminSession(
      adminUser.id,
      adminUser.sessionVersion,
      'session-2',
    );
    adminSessions.push(currentSession, oldSession);

    sessionCookieService.readSessionId.mockReturnValue(currentSession.id);

    await service.changePassword(
      createRequest({ cookie: 'stasharr_session=signed' }),
      createResponse(),
      {
        currentPassword: 'old-password-123',
        newPassword: 'new-password-456',
      },
    );

    expect(adminUsers[0]?.sessionVersion).toBe(2);
    await expect(
      argon2.verify(adminUsers[0].passwordHash, 'new-password-456'),
    ).resolves.toBe(true);
    await expect(
      argon2.verify(adminUsers[0].passwordHash, 'old-password-123'),
    ).resolves.toBe(false);
    expect(adminSessions).toHaveLength(1);
    expect(adminSessions[0]?.id).toBe(currentSession.id);
    expect(adminSessions[0]?.sessionVersion).toBe(2);

    sessionCookieService.readSessionId.mockReturnValue(oldSession.id);
    await expect(
      service.getStatus(
        createRequest({ cookie: 'stasharr_session=signed' }),
        createResponse(),
      ),
    ).resolves.toEqual({
      bootstrapRequired: false,
      authenticated: false,
      username: null,
    });
  });

  function createPrismaMock(): PrismaService {
    return {
      adminUser: {
        count: jest.fn(async () => adminUsers.length),
        create: jest.fn(async ({ data }) => {
          const record: AdminUserRecord = {
            id: `user-${adminUsers.length + 1}`,
            username: data.username,
            normalizedUsername: data.normalizedUsername,
            passwordHash: data.passwordHash,
            sessionVersion: data.sessionVersion ?? 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          adminUsers.push(record);
          return record;
        }),
        findUnique: jest.fn(async ({ where }) => {
          if (where.id) {
            return adminUsers.find((user) => user.id === where.id) ?? null;
          }

          if (where.normalizedUsername) {
            return (
              adminUsers.find(
                (user) => user.normalizedUsername === where.normalizedUsername,
              ) ?? null
            );
          }

          return null;
        }),
        update: jest.fn(async ({ where, data }) => {
          const user = adminUsers.find(
            (candidate) => candidate.id === where.id,
          );
          if (!user) {
            throw new Error(`Unknown admin user ${where.id}`);
          }

          user.passwordHash = data.passwordHash ?? user.passwordHash;
          user.sessionVersion = data.sessionVersion ?? user.sessionVersion;
          user.updatedAt = new Date();
          return user;
        }),
      },
      adminSession: {
        create: jest.fn(async ({ data }) => {
          const record: AdminSessionRecord = createAdminSession(
            data.userId,
            data.sessionVersion,
            `session-${adminSessions.length + 1}`,
          );
          record.expiresAt = data.expiresAt;
          adminSessions.push(record);
          return record;
        }),
        findUnique: jest.fn(async ({ where }) => {
          const session = adminSessions.find(
            (candidate) => candidate.id === where.id,
          );
          if (!session) {
            return null;
          }

          const user = adminUsers.find(
            (candidate) => candidate.id === session.userId,
          );
          return {
            ...session,
            user: user && {
              id: user.id,
              username: user.username,
              normalizedUsername: user.normalizedUsername,
              sessionVersion: user.sessionVersion,
            },
          };
        }),
        deleteMany: jest.fn(async ({ where }) => {
          adminSessions = adminSessions.filter(
            (session) => !matchesSessionDelete(session, where),
          );

          return { count: 1 };
        }),
        update: jest.fn(async ({ where, data }) => {
          const session = adminSessions.find(
            (candidate) => candidate.id === where.id,
          );
          if (!session) {
            throw new Error(`Unknown admin session ${where.id}`);
          }

          session.sessionVersion =
            data.sessionVersion ?? session.sessionVersion;
          session.expiresAt = data.expiresAt ?? session.expiresAt;
          session.lastSeenAt = data.lastSeenAt ?? session.lastSeenAt;
          session.updatedAt = new Date();
          return session;
        }),
      },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService;
  }
});

function createRequest(options: { cookie?: string } = {}): Request {
  return {
    headers: options.cookie ? { cookie: options.cookie } : {},
    ip: '127.0.0.1',
    socket: {
      remoteAddress: '127.0.0.1',
    },
  } as unknown as Request;
}

function createResponse(): Response {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response;
}

async function createAdminUser(
  username: string,
  password: string,
): Promise<AdminUserRecord> {
  return {
    id: `user-${username}`,
    username,
    normalizedUsername: username.toLowerCase(),
    passwordHash: await argon2.hash(password, {
      type: argon2.argon2id,
    }),
    sessionVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createAdminSession(
  userId: string,
  sessionVersion: number,
  id: string,
): AdminSessionRecord {
  return {
    id,
    userId,
    sessionVersion,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    lastSeenAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function matchesSessionDelete(
  session: AdminSessionRecord,
  where: Record<string, unknown>,
): boolean {
  if (typeof where.id === 'string') {
    return session.id === where.id;
  }

  if (where.id && typeof where.id === 'object' && 'not' in where.id) {
    return session.userId === where.userId && session.id !== where.id.not;
  }

  if (typeof where.userId === 'string') {
    return session.userId === where.userId;
  }

  return false;
}
