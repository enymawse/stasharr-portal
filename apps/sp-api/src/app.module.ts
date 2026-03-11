import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoverModule } from './discover/discover.module';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScenesModule } from './scenes/scenes.module';
import { SetupModule } from './setup/setup.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env'],
    }),
    PrismaModule,
    HealthModule,
    IntegrationsModule,
    SetupModule,
    DiscoverModule,
    ScenesModule,
  ],
})
export class AppModule {}
