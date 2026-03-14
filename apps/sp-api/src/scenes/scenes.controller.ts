import { Controller, Get, Param, Query } from '@nestjs/common';
import { DiscoverQueryDto } from '../discover/dto/discover-query.dto';
import { DiscoverResponseDto } from '../discover/dto/discover-item.dto';
import { SceneDetailsDto } from './dto/scene-details.dto';
import { ScenesService } from './scenes.service';

@Controller('api/scenes')
export class ScenesController {
  constructor(private readonly scenesService: ScenesService) {}

  @Get()
  getScenesFeed(
    @Query() query: DiscoverQueryDto,
  ): Promise<DiscoverResponseDto> {
    return this.scenesService.getScenesFeed(query.page, query.perPage);
  }

  @Get(':stashId')
  getSceneById(@Param('stashId') stashId: string): Promise<SceneDetailsDto> {
    return this.scenesService.getSceneById(stashId);
  }
}
