import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';

@Module({
  imports: [IntegrationsModule, StashdbModule],
  controllers: [ScenesController],
  providers: [ScenesService],
})
export class ScenesModule {}
