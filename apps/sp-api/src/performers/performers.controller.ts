import { Controller, Get, Query } from '@nestjs/common';
import { PerformerFeedResponseDto } from './dto/performer-feed-response.dto';
import { PerformersQueryDto } from './dto/performers-query.dto';
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
}
