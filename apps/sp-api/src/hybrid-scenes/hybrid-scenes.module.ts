import { Module } from '@nestjs/common';
import { StashModule } from '../providers/stash/stash.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { HybridScenesService } from './hybrid-scenes.service';

@Module({
  imports: [StashModule, StashdbModule],
  providers: [HybridScenesService],
  exports: [HybridScenesService],
})
export class HybridScenesModule {}
