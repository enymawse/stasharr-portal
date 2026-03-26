import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { SceneTagOptionDto } from './dto/scene-tag-option.dto';
import { SceneDetailsDto } from './dto/scene-details.dto';
import { ScenesFeedResponseDto } from './dto/scenes-feed.dto';
import { ScenesQueryDto } from './dto/scenes-query.dto';
import { ScenesTagsQueryDto } from './dto/scenes-tags-query.dto';
import { ToggleFavoriteDto } from './dto/toggle-favorite.dto';
import { ScenesService } from './scenes.service';

@Controller('api/scenes')
export class ScenesController {
  constructor(private readonly scenesService: ScenesService) {}

  @Get()
  getScenesFeed(
    @Query() query: ScenesQueryDto,
  ): Promise<ScenesFeedResponseDto> {
    return this.scenesService.getScenesFeed(
      query.page,
      query.perPage,
      query.sort,
      query.direction,
      query.tagIds,
      query.tagMode,
      query.favorites,
      query.studioIds,
      query.libraryAvailability,
      query.stashFavoritePerformersOnly,
      query.stashFavoriteStudiosOnly,
      query.stashFavoriteTagsOnly,
    );
  }

  @Get('tags')
  getSceneTagOptions(@Query() query: ScenesTagsQueryDto): Promise<SceneTagOptionDto[]> {
    return this.scenesService.searchSceneTags(query.query);
  }

  @Post('studios/:studioId/favorite')
  favoriteStudio(
    @Param('studioId') studioId: string,
    @Body() body: ToggleFavoriteDto,
  ): Promise<{ favorited: boolean; alreadyFavorited: boolean }> {
    return this.scenesService.favoriteStudio(studioId, body.favorite);
  }

  @Get(':stashId')
  getSceneById(@Param('stashId') stashId: string): Promise<SceneDetailsDto> {
    return this.scenesService.getSceneById(stashId);
  }
}
