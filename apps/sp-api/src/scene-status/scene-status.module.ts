import { Module } from '@nestjs/common';
import { IndexingModule } from '../indexing/indexing.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashModule } from '../providers/stash/stash.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { SceneStatusService } from './scene-status.service';

@Module({
  imports: [IndexingModule, IntegrationsModule, StashModule, WhisparrModule],
  providers: [SceneStatusService],
  exports: [SceneStatusService],
})
export class SceneStatusModule {}
