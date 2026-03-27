import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RequestOptionsDto } from './dto/request-options.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene-request.dto';
import { SubmitSceneRequestResponseDto } from './dto/submit-scene-request-response.dto';
import { RequestsService } from './requests.service';

@Controller('api/requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get(':stashId/options')
  getRequestOptions(
    @Param('stashId') stashId: string,
  ): Promise<RequestOptionsDto> {
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
