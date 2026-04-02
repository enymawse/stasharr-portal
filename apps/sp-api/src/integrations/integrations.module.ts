import { Module } from '@nestjs/common';
import { StashModule } from '../providers/stash/stash.module';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { RuntimeHealthModule } from '../runtime-health/runtime-health.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { RuntimeHealthRefreshController } from './runtime-health-refresh.controller';

@Module({
  imports: [StashModule, StashdbModule, WhisparrModule, RuntimeHealthModule],
  controllers: [IntegrationsController, RuntimeHealthRefreshController],
  providers: [IntegrationsService, CatalogProviderService],
  exports: [IntegrationsService, CatalogProviderService],
})
export class IntegrationsModule {}
