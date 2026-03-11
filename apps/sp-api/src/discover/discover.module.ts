import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { DiscoverController } from './discover.controller';
import { DiscoverService } from './discover.service';

@Module({
  imports: [IntegrationsModule, StashdbModule, SceneStatusModule],
  controllers: [DiscoverController],
  providers: [DiscoverService],
})
export class DiscoverModule {}
