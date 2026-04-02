import { Module } from '@nestjs/common';
import { RuntimeHealthModule } from '../../runtime-health/runtime-health.module';
import { StashdbAdapter } from './stashdb.adapter';

@Module({
  imports: [RuntimeHealthModule],
  providers: [StashdbAdapter],
  exports: [StashdbAdapter],
})
export class StashdbModule {}
