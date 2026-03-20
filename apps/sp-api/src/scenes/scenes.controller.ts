import { Controller, Get, Param, Query } from '@nestjs/common';
import { DiscoverResponseDto } from '../discover/dto/discover-item.dto';
import { SceneDetailsDto } from './dto/scene-details.dto';
import { ScenesQueryDto } from './dto/scenes-query.dto';
import { ScenesService } from './scenes.service';

@Controller('api/scenes')
export class ScenesController {
  constructor(private readonly scenesService: ScenesService) {}

  @Get()
  getScenesFeed(
    @Query() query: ScenesQueryDto,
  ): Promise<DiscoverResponseDto> {
    return this.scenesService.getScenesFeed(query.page, query.perPage, query.sort);
  }

  @Get(':stashId')
  getSceneById(@Param('stashId') stashId: string): Promise<SceneDetailsDto> {
    return this.scenesService.getSceneById(stashId);
  }
}
