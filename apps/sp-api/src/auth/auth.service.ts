import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import {
  type AuthStatusResponse,
  type AuthenticatedAdmin,
  type AuthenticatedRequest,
  type RequestAuthContext,
} from './auth.types';
import { LoginAttemptService } from './login-attempt.service';
import { SessionCookieService } from './session-cookie.service';

type AdminSessionRecord = Awaited<ReturnType<AuthService['loadSessionRecord']>>;

@Injectable()
export class AuthService {
  private static readonly SESSION_TOUCH_INTERVAL_MS = 15 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionCookieService: SessionCookieService,
    private readonly loginAttemptService: LoginAttemptService,
  ) {}

  async getStatus(
    request: Request,
    response: Response,
  ): Promise<AuthStatusResponse> {
    return this.toStatus(await this.resolveRequestAuth(request, response));
  }

  async bootstrapAdmin(
    dto: BootstrapAdminDto,
    request: Request,
    response: Response,
  ): Promise<AuthStatusResponse> {
    if ((await this.prisma.adminUser.count()) > 0) {
      throw new ConflictException('Bootstrap is no longer available.');
    }

    const user = await this.prisma.adminUser.create({
      data: {
        username: dto.username.trim(),
        normalizedUsername: normalizeUsername(dto.username),
        passwordHash: await argon2.hash(dto.password, {
          type: argon2.argon2id,
        }),
      },
    });

    const sessionId = await this.startSession(
      user.id,
      user.sessionVersion,
      response,
    );
    return this.toStatus(
      this.writeCachedRequestAuth(request, {
        bootstrapRequired: false,
        authenticated: true,
        user: {
          id: user.id,
          username: user.username,
          normalizedUsername: user.normalizedUsername,
          sessionVersion: user.sessionVersion,
        },
        sessionId,
      }),
    );
  }

  async login(
    dto: LoginDto,
    request: Request,
    response: Response,
  ): Promise<AuthStatusResponse> {
    const normalizedUsername = normalizeUsername(dto.username);
    const ipAddress = this.getRequestIp(request);

    this.assertLoginAllowed(ipAddress, normalizedUsername);

    const adminUser = await this.prisma.adminUser.findUnique({
      where: {
        normalizedUsername,
      },
    });

    if (!adminUser) {
      if ((await this.prisma.adminUser.count()) === 0) {
        throw new ConflictException('Bootstrap is required before logging in.');
      }

      this.recordLoginFailure(ipAddress, normalizedUsername);
      throw new UnauthorizedException('Invalid username or password.');
    }

    const passwordMatches = await argon2.verify(
      adminUser.passwordHash,
      dto.password,
    );
    if (!passwordMatches) {
      this.recordLoginFailure(ipAddress, normalizedUsername);
      throw new UnauthorizedException('Invalid username or password.');
    }

    this.clearLoginFailures(ipAddress, normalizedUsername);
    const sessionId = await this.startSession(
      adminUser.id,
      adminUser.sessionVersion,
      response,
    );
    return this.toStatus(
      this.writeCachedRequestAuth(request, {
        bootstrapRequired: false,
        authenticated: true,
        user: {
          id: adminUser.id,
          username: adminUser.username,
          normalizedUsername: adminUser.normalizedUsername,
          sessionVersion: adminUser.sessionVersion,
        },
        sessionId,
      }),
    );
  }

  async logout(
    request: Request,
    response: Response,
  ): Promise<AuthStatusResponse> {
    const authContext = await this.resolveRequestAuth(request, response);
    if (authContext.sessionId) {
      await this.prisma.adminSession.deleteMany({
        where: {
          id: authContext.sessionId,
        },
      });
    }

    this.sessionCookieService.clearSessionCookie(response);
    const bootstrapRequired = (await this.prisma.adminUser.count()) === 0;

    const unauthenticatedStatus: RequestAuthContext = {
      bootstrapRequired,
      authenticated: false,
      user: null,
      sessionId: null,
    };
    this.writeCachedRequestAuth(request, unauthenticatedStatus);

    return this.toStatus(unauthenticatedStatus);
  }

  async changePassword(
    request: Request,
    response: Response,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const authContext = await this.requireAuthenticatedRequest(
      request,
      response,
    );
    const adminUser = await this.prisma.adminUser.findUnique({
      where: {
        id: authContext.user.id,
      },
    });

    if (!adminUser) {
      throw new UnauthorizedException('Authentication required.');
    }

    const currentPasswordMatches = await argon2.verify(
      adminUser.passwordHash,
      dto.currentPassword,
    );

    if (!currentPasswordMatches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current password.',
      );
    }

    const nextSessionVersion = adminUser.sessionVersion + 1;
    const nextExpiresAt = this.buildSessionExpiry();

    await this.prisma.$transaction([
      this.prisma.adminUser.update({
        where: {
          id: adminUser.id,
        },
        data: {
          passwordHash: await argon2.hash(dto.newPassword, {
            type: argon2.argon2id,
          }),
          sessionVersion: nextSessionVersion,
        },
      }),
      this.prisma.adminSession.update({
        where: {
          id: authContext.sessionId,
        },
        data: {
          sessionVersion: nextSessionVersion,
          expiresAt: nextExpiresAt,
          lastSeenAt: new Date(),
        },
      }),
      this.prisma.adminSession.deleteMany({
        where: {
          userId: adminUser.id,
          id: {
            not: authContext.sessionId,
          },
        },
      }),
    ]);

    this.sessionCookieService.setSessionCookie(
      response,
      authContext.sessionId,
      nextExpiresAt,
    );
    this.writeCachedRequestAuth(request, {
      bootstrapRequired: false,
      authenticated: true,
      user: {
        ...authContext.user,
        sessionVersion: nextSessionVersion,
      },
      sessionId: authContext.sessionId,
    });
  }

  async resolveRequestAuth(
    request: Request,
    response?: Response,
  ): Promise<RequestAuthContext> {
    const authenticatedRequest = request as AuthenticatedRequest;
    if (authenticatedRequest.authContext) {
      return authenticatedRequest.authContext;
    }

    const adminUserCount = await this.prisma.adminUser.count();
    if (adminUserCount === 0) {
      if (response) {
        this.sessionCookieService.clearSessionCookie(response);
      }

      return this.writeCachedRequestAuth(request, {
        bootstrapRequired: true,
        authenticated: false,
        user: null,
        sessionId: null,
      });
    }

    const sessionId = this.sessionCookieService.readSessionId(
      request.headers.cookie,
    );
    if (!sessionId) {
      return this.writeCachedRequestAuth(request, {
        bootstrapRequired: false,
        authenticated: false,
        user: null,
        sessionId: null,
      });
    }

    const session = await this.loadSessionRecord(sessionId);
    if (!session) {
      if (response) {
        this.sessionCookieService.clearSessionCookie(response);
      }

      return this.writeCachedRequestAuth(request, {
        bootstrapRequired: false,
        authenticated: false,
        user: null,
        sessionId: null,
      });
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.adminSession.deleteMany({
        where: {
          id: session.id,
        },
      });
      if (response) {
        this.sessionCookieService.clearSessionCookie(response);
      }

      return this.writeCachedRequestAuth(request, {
        bootstrapRequired: false,
        authenticated: false,
        user: null,
        sessionId: null,
      });
    }

    if (
      !session.user ||
      session.sessionVersion !== session.user.sessionVersion
    ) {
      await this.prisma.adminSession.deleteMany({
        where: {
          id: session.id,
        },
      });
      if (response) {
        this.sessionCookieService.clearSessionCookie(response);
      }

      return this.writeCachedRequestAuth(request, {
        bootstrapRequired: false,
        authenticated: false,
        user: null,
        sessionId: null,
      });
    }

    const authContext: RequestAuthContext = {
      bootstrapRequired: false,
      authenticated: true,
      user: {
        id: session.user.id,
        username: session.user.username,
        normalizedUsername: session.user.normalizedUsername,
        sessionVersion: session.user.sessionVersion,
      },
      sessionId: session.id,
    };
    this.writeCachedRequestAuth(request, authContext);

    await this.touchSessionIfNeeded(session, response);
    return authContext;
  }

  async requireAuthenticatedRequest(
    request: Request,
    response?: Response,
  ): Promise<{
    bootstrapRequired: false;
    authenticated: true;
    user: AuthenticatedAdmin;
    sessionId: string;
  }> {
    const authContext = await this.resolveRequestAuth(request, response);
    if (
      !authContext.authenticated ||
      !authContext.user ||
      !authContext.sessionId
    ) {
      throw new UnauthorizedException('Authentication required.');
    }

    return {
      bootstrapRequired: false,
      authenticated: true,
      user: authContext.user,
      sessionId: authContext.sessionId,
    };
  }

  private async startSession(
    userId: string,
    sessionVersion: number,
    response: Response,
  ): Promise<string> {
    const expiresAt = this.buildSessionExpiry();
    const session = await this.prisma.adminSession.create({
      data: {
        userId,
        sessionVersion,
        expiresAt,
      },
    });

    this.sessionCookieService.setSessionCookie(response, session.id, expiresAt);
    return session.id;
  }

  private buildSessionExpiry(): Date {
    return new Date(Date.now() + this.sessionCookieService.sessionTtlMs);
  }

  private async loadSessionRecord(sessionId: string) {
    return this.prisma.adminSession.findUnique({
      where: {
        id: sessionId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            normalizedUsername: true,
            sessionVersion: true,
          },
        },
      },
    });
  }

  private async touchSessionIfNeeded(
    session: NonNullable<AdminSessionRecord>,
    response?: Response,
  ): Promise<void> {
    if (!response) {
      return;
    }

    if (
      Date.now() - session.lastSeenAt.getTime() <
      AuthService.SESSION_TOUCH_INTERVAL_MS
    ) {
      return;
    }

    const expiresAt = this.buildSessionExpiry();
    await this.prisma.adminSession.update({
      where: {
        id: session.id,
      },
      data: {
        expiresAt,
        lastSeenAt: new Date(),
      },
    });
    this.sessionCookieService.setSessionCookie(response, session.id, expiresAt);
  }

  private assertLoginAllowed(
    ipAddress: string,
    normalizedUsername: string,
  ): void {
    this.loginAttemptService.assertAllowed(this.loginAttemptIpKey(ipAddress));
    this.loginAttemptService.assertAllowed(
      this.loginAttemptUsernameKey(ipAddress, normalizedUsername),
    );
  }

  private recordLoginFailure(
    ipAddress: string,
    normalizedUsername: string,
  ): void {
    this.loginAttemptService.recordFailure(this.loginAttemptIpKey(ipAddress));
    this.loginAttemptService.recordFailure(
      this.loginAttemptUsernameKey(ipAddress, normalizedUsername),
    );
  }

  private clearLoginFailures(
    ipAddress: string,
    normalizedUsername: string,
  ): void {
    this.loginAttemptService.clear(this.loginAttemptIpKey(ipAddress));
    this.loginAttemptService.clear(
      this.loginAttemptUsernameKey(ipAddress, normalizedUsername),
    );
  }

  private loginAttemptIpKey(ipAddress: string): string {
    return `ip:${ipAddress}`;
  }

  private loginAttemptUsernameKey(
    ipAddress: string,
    normalizedUsername: string,
  ): string {
    return `login:${ipAddress}:${normalizedUsername}`;
  }

  private getRequestIp(request: Request): string {
    const forwardedForHeader = request.headers['x-forwarded-for'];
    if (
      typeof forwardedForHeader === 'string' &&
      forwardedForHeader.trim().length > 0
    ) {
      return forwardedForHeader.split(',')[0]?.trim() || 'unknown';
    }

    return request.ip || request.socket.remoteAddress || 'unknown';
  }

  private toStatus(authContext: RequestAuthContext): AuthStatusResponse {
    return {
      bootstrapRequired: authContext.bootstrapRequired,
      authenticated: authContext.authenticated,
      username: authContext.user?.username ?? null,
    };
  }

  private writeCachedRequestAuth(
    request: Request,
    authContext: RequestAuthContext,
  ): RequestAuthContext {
    (request as AuthenticatedRequest).authContext = authContext;
    return authContext;
  }

  private clearCachedRequestAuth(request: Request): void {
    delete (request as AuthenticatedRequest).authContext;
  }
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
