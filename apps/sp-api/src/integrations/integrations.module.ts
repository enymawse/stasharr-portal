import { Module } from '@nestjs/common';
import { StashModule } from '../providers/stash/stash.module';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { WhisparrModule } from '../providers/whisparr/whisparr.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  imports: [StashModule, StashdbModule, WhisparrModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, CatalogProviderService],
  exports: [IntegrationsService, CatalogProviderService],
})
export class IntegrationsModule {}
