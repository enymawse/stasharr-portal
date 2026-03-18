import { Controller, Get, Query } from '@nestjs/common';
import { DiscoverResponseDto } from '../discover/dto/discover-item.dto';
import { DiscoverQueryDto } from '../discover/dto/discover-query.dto';
import { RequestsService } from './requests.service';

@Controller('api/requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  getRequestsFeed(
    @Query() query: DiscoverQueryDto,
  ): Promise<DiscoverResponseDto> {
    return this.requestsService.getRequestsFeed(query.page, query.perPage);
  }
}
