import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LibraryController } from './library.controller';
import { LibrarySceneQueryService } from './library-scene-query.service';
import { LibraryService } from './library.service';

@Module({
  imports: [PrismaModule],
  controllers: [LibraryController],
  providers: [LibraryService, LibrarySceneQueryService],
  exports: [LibraryService],
})
export class LibraryModule {}
