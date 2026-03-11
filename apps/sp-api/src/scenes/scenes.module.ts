import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';

@Module({
  imports: [IntegrationsModule, StashdbModule, SceneStatusModule],
  controllers: [ScenesController],
  providers: [ScenesService],
})
export class ScenesModule {}
