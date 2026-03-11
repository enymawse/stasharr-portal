import { Controller, Get, Query } from '@nestjs/common';
import { DiscoverQueryDto } from './dto/discover-query.dto';
import { DiscoverResponseDto } from './dto/discover-item.dto';
import { DiscoverService } from './discover.service';

@Controller('api/discover')
export class DiscoverController {
  constructor(private readonly discoverService: DiscoverService) {}

  @Get()
  getDiscoverFeed(
    @Query() query: DiscoverQueryDto,
  ): Promise<DiscoverResponseDto> {
    return this.discoverService.getDiscoverFeed(query.page, query.perPage);
  }
}
