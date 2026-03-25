import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StashModule } from '../providers/stash/stash.module';
import { StashdbModule } from '../providers/stashdb/stashdb.module';
import { SceneStatusModule } from '../scene-status/scene-status.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [PrismaModule, StashModule, StashdbModule, SceneStatusModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
