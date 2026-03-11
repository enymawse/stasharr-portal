import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { SceneStatusService } from './scene-status.service';

@Module({
  imports: [IntegrationsModule, WhisparrModule],
  providers: [SceneStatusService],
  exports: [SceneStatusService],
})
export class SceneStatusModule {}
