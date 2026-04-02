import { Module } from '@nestjs/common';
import { RuntimeHealthModule } from '../../runtime-health/runtime-health.module';
import { StashAdapter } from './stash.adapter';

@Module({
  imports: [RuntimeHealthModule],
  providers: [StashAdapter],
  exports: [StashAdapter],
})
export class StashModule {}
