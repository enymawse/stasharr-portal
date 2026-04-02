import { Controller, Get } from '@nestjs/common';
import { RuntimeHealthService } from './runtime-health.service';

@Controller('api/health/runtime')
export class RuntimeHealthController {
  constructor(private readonly runtimeHealthService: RuntimeHealthService) {}

  @Get()
  getSummary() {
    return this.runtimeHealthService.getSummary();
  }
}
