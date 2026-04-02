import { Module } from '@nestjs/common';
import { RuntimeHealthModule } from '../../runtime-health/runtime-health.module';
import { WhisparrAdapter } from './whisparr.adapter';

@Module({
  imports: [RuntimeHealthModule],
  providers: [WhisparrAdapter],
  exports: [WhisparrAdapter],
})
export class WhisparrModule {}
