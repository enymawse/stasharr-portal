import { Controller, Get, Query } from '@nestjs/common';
import { StudioFeedResponseDto } from './dto/studio-feed-response.dto';
import { StudiosQueryDto } from './dto/studios-query.dto';
import { StudiosService } from './studios.service';

@Controller('api/studios')
export class StudiosController {
  constructor(private readonly studiosService: StudiosService) {}

  @Get()
  getStudiosFeed(
    @Query() query: StudiosQueryDto,
  ): Promise<StudioFeedResponseDto> {
    return this.studiosService.getStudiosFeed(query.page, query.perPage, {
      name: query.name,
      sort: query.sort,
      direction: query.direction,
      favoritesOnly: query.favoritesOnly,
    });
  }
}
