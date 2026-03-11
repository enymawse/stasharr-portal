import { Module } from '@nestjs/common';
import { SceneStatusService } from './scene-status.service';

@Module({
  providers: [SceneStatusService],
  exports: [SceneStatusService],
})
export class SceneStatusModule {}
