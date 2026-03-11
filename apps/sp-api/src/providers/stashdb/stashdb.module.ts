import { Module } from '@nestjs/common';
import { StashdbAdapter } from './stashdb.adapter';

@Module({
  providers: [StashdbAdapter],
  exports: [StashdbAdapter],
})
export class StashdbModule {}
