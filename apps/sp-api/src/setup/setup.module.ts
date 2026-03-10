import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [SetupController],
  providers: [SetupService],
})
export class SetupModule {}
