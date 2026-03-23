import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DiscoverResponseDto } from '../discover/dto/discover-item.dto';
import { PerformerDetailsDto } from './dto/performer-details.dto';
import { PerformerFeedResponseDto } from './dto/performer-feed-response.dto';
import { PerformerScenesQueryDto } from './dto/performer-scenes-query.dto';
import { PerformerStudioOptionDto } from './dto/performer-studio-option.dto';
import { PerformersQueryDto } from './dto/performers-query.dto';
import { PerformerStudiosQueryDto } from './dto/performer-studios-query.dto';
import { ToggleFavoriteDto } from './dto/toggle-favorite.dto';
import { PerformersService } from './performers.service';

@Controller('api/performers')
export class PerformersController {
  constructor(private readonly performersService: PerformersService) {}

  @Get()
  getPerformersFeed(
    @Query() query: PerformersQueryDto,
  ): Promise<PerformerFeedResponseDto> {
    return this.performersService.getPerformersFeed(query.page, query.perPage, {
      name: query.name,
      gender: query.gender,
      sort: query.sort,
      favoritesOnly: query.favoritesOnly,
    });
  }

  @Get('studios')
  getStudioOptions(
    @Query() query: PerformerStudiosQueryDto,
  ): Promise<PerformerStudioOptionDto[]> {
    return this.performersService.searchStudios(query.query);
  }

  @Get(':performerId/scenes')
  getPerformerScenes(
    @Param('performerId') performerId: string,
    @Query() query: PerformerScenesQueryDto,
  ): Promise<DiscoverResponseDto> {
    return this.performersService.getPerformerScenes(
      performerId,
      query.page,
      query.perPage,
      {
        sort: query.sort,
        studioIds: query.studioIds,
        tagIds: query.tagIds,
        onlyFavoriteStudios: query.onlyFavoriteStudios,
      },
    );
  }

  @Get(':performerId')
  getPerformerById(
    @Param('performerId') performerId: string,
  ): Promise<PerformerDetailsDto> {
    return this.performersService.getPerformerById(performerId);
  }

  @Post(':performerId/favorite')
  favoritePerformer(
    @Param('performerId') performerId: string,
    @Body() body: ToggleFavoriteDto,
  ): Promise<{ favorited: boolean; alreadyFavorited: boolean }> {
    return this.performersService.favoritePerformer(performerId, body.favorite);
  }
}
