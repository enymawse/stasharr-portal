import { Module } from '@nestjs/common';
import { WhisparrAdapter } from './whisparr.adapter';

@Module({
  providers: [WhisparrAdapter],
  exports: [WhisparrAdapter],
})
export class WhisparrModule {}
