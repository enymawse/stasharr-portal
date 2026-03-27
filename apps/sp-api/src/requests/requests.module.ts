import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [IntegrationsModule, WhisparrModule, StashdbModule],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
