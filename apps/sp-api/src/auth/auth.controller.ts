import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';
import { type AuthStatusResponse } from './auth.types';
import { BootstrapAdminDto } from './dto/bootstrap-admin.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('status')
  getStatus(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthStatusResponse> {
    return this.authService.getStatus(request, response);
  }

  @Public()
  @Post('bootstrap')
  bootstrap(
    @Body() dto: BootstrapAdminDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthStatusResponse> {
    return this.authService.bootstrapAdmin(dto, request, response);
  }

  @Public()
  @Post('login')
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthStatusResponse> {
    return this.authService.login(dto, request, response);
  }

  @Public()
  @Post('logout')
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthStatusResponse> {
    return this.authService.logout(request, response);
  }

  @Post('change-password')
  changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    return this.authService.changePassword(request, response, dto);
  }
}
