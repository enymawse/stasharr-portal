import { Module } from '@nestjs/common';
import { StashAdapter } from './stash.adapter';

@Module({
  providers: [StashAdapter],
  exports: [StashAdapter],
})
export class StashModule {}
