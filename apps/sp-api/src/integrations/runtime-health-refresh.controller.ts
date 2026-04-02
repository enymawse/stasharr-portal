import { Controller, Post } from '@nestjs/common';
import { RuntimeHealthResponse } from '../runtime-health/runtime-health.types';
import { IntegrationsService } from './integrations.service';

@Controller('api/health/runtime')
export class RuntimeHealthRefreshController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Post('refresh')
  refresh(): Promise<RuntimeHealthResponse> {
    return this.integrationsService.refreshRuntimeHealth();
  }
}
