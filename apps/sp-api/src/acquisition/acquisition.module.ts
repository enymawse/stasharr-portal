import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { AcquisitionController } from './acquisition.controller';
import { AcquisitionService } from './acquisition.service';

@Module({
  imports: [
    IntegrationsModule,
    WhisparrModule,
    StashdbModule,
    SceneStatusModule,
  ],
  controllers: [AcquisitionController],
  providers: [AcquisitionService],
})
export class AcquisitionModule {}
