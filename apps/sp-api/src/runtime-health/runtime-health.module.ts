import { Module } from '@nestjs/common';
import { RuntimeHealthController } from './runtime-health.controller';
import { RuntimeHealthService } from './runtime-health.service';

@Module({
  controllers: [RuntimeHealthController],
  providers: [RuntimeHealthService],
  exports: [RuntimeHealthService],
})
export class RuntimeHealthModule {}
