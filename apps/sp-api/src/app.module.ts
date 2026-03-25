import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoverModule } from './discover/discover.module';
import { HealthModule } from './health/health.module';
import { HomeModule } from './home/home.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { MediaModule } from './media/media.module';
import { PrismaModule } from './prisma/prisma.module';
import { PerformersModule } from './performers/performers.module';
import { RequestsModule } from './requests/requests.module';
import { ScenesModule } from './scenes/scenes.module';
import { SetupModule } from './setup/setup.module';
import { StudiosModule } from './studios/studios.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env'],
    }),
    PrismaModule,
    HealthModule,
    HomeModule,
    MediaModule,
    IntegrationsModule,
    SetupModule,
    DiscoverModule,
    ScenesModule,
    RequestsModule,
    PerformersModule,
    StudiosModule,
  ],
})
export class AppModule {}
