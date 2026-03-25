import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StashModule } from '../providers/stash/stash.module';
import { HomeController } from './home.controller';
import { HomeService } from './home.service';

@Module({
  imports: [PrismaModule, StashModule],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
