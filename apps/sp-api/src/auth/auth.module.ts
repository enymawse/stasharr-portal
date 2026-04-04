import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminSessionGuard } from './admin-session.guard';
import { LoginAttemptService } from './login-attempt.service';
import { SessionCookieService } from './session-cookie.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionCookieService,
    LoginAttemptService,
    Reflector,
    {
      provide: APP_GUARD,
      useClass: AdminSessionGuard,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
