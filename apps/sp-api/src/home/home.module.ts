import { Module } from '@nestjs/common';
import { HybridScenesModule } from '../hybrid-scenes/hybrid-scenes.module';
import { LibraryModule } from '../library/library.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [PrismaModule, LibraryModule, SceneStatusModule, HybridScenesModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
