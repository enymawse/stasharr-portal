import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { PerformersController } from './performers.controller';
import { PerformersService } from './performers.service';

@Module({
  imports: [IntegrationsModule, StashdbModule],
  controllers: [PerformersController],
  providers: [PerformersService],
})
export class PerformersModule {}
