import { Controller, Get } from '@nestjs/common';
import { SetupService, SetupStatusResponse } from './setup.service';

@Controller('api/setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get('status')
  getStatus(): Promise<SetupStatusResponse> {
    return this.setupService.getStatus();
  }
}
