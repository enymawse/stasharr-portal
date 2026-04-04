/* eslint-disable @typescript-eslint/unbound-method */

import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { HealthController } from '../health/health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SetupController } from '../setup/setup.controller';
import { SetupService } from '../setup/setup.service';
import { AdminSessionGuard } from './admin-session.guard';
import { AuthService } from './auth.service';

describe('AdminSessionGuard', () => {
  it('keeps the health route public so healthchecks work without authentication', async () => {
    const authService = {
      resolveRequestAuth: jest.fn(),
    } as unknown as AuthService;
    const guard = new AdminSessionGuard(new Reflector(), authService);

    await expect(
      guard.canActivate(
        createExecutionContext(
          HealthController,
          HealthController.prototype.getStatus,
        ),
      ),
    ).resolves.toBe(true);
    expect(authService.resolveRequestAuth).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated access to protected routes', async () => {
    const authService = {
      resolveRequestAuth: jest.fn().mockResolvedValue({
        bootstrapRequired: false,
        authenticated: false,
        user: null,
        sessionId: null,
      }),
    } as unknown as AuthService;
    const guard = new AdminSessionGuard(new Reflector(), authService);

    await expect(
      guard.canActivate(
        createExecutionContext(
          SetupController,
          SetupController.prototype.getStatus,
        ),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authService.resolveRequestAuth).toHaveBeenCalledTimes(1);
  });
});

function createExecutionContext(
  controllerClass: object,
  handler: (...args: never[]) => unknown,
) {
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => ({ headers: {} }) as Request,
      getResponse: () => ({ clearCookie: jest.fn() }) as unknown as Response,
    }),
  };
}

void PrismaService;
void SetupService;
