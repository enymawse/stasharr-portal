import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DiscoverResponseDto } from '../discover/dto/discover-item.dto';
import { SceneTagOptionDto } from './dto/scene-tag-option.dto';
import { SceneDetailsDto } from './dto/scene-details.dto';
import { ScenesQueryDto } from './dto/scenes-query.dto';
import { ScenesTagsQueryDto } from './dto/scenes-tags-query.dto';
import { ScenesService } from './scenes.service';

@Controller('api/scenes')
export class ScenesController {
  constructor(private readonly scenesService: ScenesService) {}

  @Get()
  getScenesFeed(
    @Query() query: ScenesQueryDto,
  ): Promise<DiscoverResponseDto> {
    return this.scenesService.getScenesFeed(
      query.page,
      query.perPage,
      query.sort,
      query.tagIds,
      query.tagMode,
      query.favorites,
      query.studioIds,
    );
  }

  @Get('tags')
  getSceneTagOptions(@Query() query: ScenesTagsQueryDto): Promise<SceneTagOptionDto[]> {
    return this.scenesService.searchSceneTags(query.query);
  }

  @Post('studios/:studioId/favorite')
  favoriteStudio(
    @Param('studioId') studioId: string,
  ): Promise<{ favorited: true; alreadyFavorited: boolean }> {
    return this.scenesService.favoriteStudio(studioId);
  }

  @Get(':stashId')
  getSceneById(@Param('stashId') stashId: string): Promise<SceneDetailsDto> {
    return this.scenesService.getSceneById(stashId);
  }
}
