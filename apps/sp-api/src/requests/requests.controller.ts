import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DiscoverResponseDto } from '../discover/dto/discover-item.dto';
import { DiscoverQueryDto } from '../discover/dto/discover-query.dto';
import { RequestOptionsDto } from './dto/request-options.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene-request.dto';
import { SubmitSceneRequestResponseDto } from './dto/submit-scene-request-response.dto';
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

  @Get(':stashId/options')
  getRequestOptions(@Param('stashId') stashId: string): Promise<RequestOptionsDto> {
    return this.requestsService.getRequestOptions(stashId);
  }

  @Post(':stashId')
  submitSceneRequest(
    @Param('stashId') stashId: string,
    @Body() payload: SubmitSceneRequestDto,
  ): Promise<SubmitSceneRequestResponseDto> {
    return this.requestsService.submitSceneRequest(stashId, payload);
  }
}
