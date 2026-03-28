import { Module } from '@nestjs/common';
import { IndexingModule } from '../indexing/indexing.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { AcquisitionController } from './acquisition.controller';
import { AcquisitionService } from './acquisition.service';

@Module({
  imports: [IndexingModule, IntegrationsModule, WhisparrModule],
  controllers: [AcquisitionController],
  providers: [AcquisitionService],
})
export class AcquisitionModule {}
