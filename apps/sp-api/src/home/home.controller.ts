import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CreateHomeRailDto, UpdateHomeRailDto } from './dto/create-home-rail.dto';
import { HomeRailContentDto } from './dto/home-rail-content.dto';
import { HomeRailDto } from './dto/home-rail.dto';
import { UpdateHomeRailsDto } from './dto/update-home-rails.dto';
import { HomeService } from './home.service';
import { SceneTagOptionDto } from '../scenes/dto/scene-tag-option.dto';
import { PerformerStudioOptionDto } from '../performers/dto/performer-studio-option.dto';

@Controller('api/home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('rails')
  getRails(): Promise<HomeRailDto[]> {
    return this.homeService.getRails();
  }

  @Get('stash/tags')
  searchStashTags(@Query('query') query?: string): Promise<SceneTagOptionDto[]> {
    return this.homeService.searchStashTags(query);
  }

  @Get('stash/studios')
  searchStashStudios(
    @Query('query') query?: string,
  ): Promise<PerformerStudioOptionDto[]> {
    return this.homeService.searchStashStudios(query);
  }

  @Get('rails/:id/items')
  getRailContent(@Param('id') id: string): Promise<HomeRailContentDto> {
    return this.homeService.getRailContent(id);
  }

  @Put('rails')
  updateRails(@Body() payload: UpdateHomeRailsDto): Promise<HomeRailDto[]> {
    return this.homeService.updateRails(payload);
  }

  @Post('rails')
  createRail(@Body() payload: CreateHomeRailDto): Promise<HomeRailDto> {
    return this.homeService.createRail(payload);
  }

  @Patch('rails/:id')
  updateRail(
    @Param('id') id: string,
    @Body() payload: UpdateHomeRailDto,
  ): Promise<HomeRailDto> {
    return this.homeService.updateRail(id, payload);
  }

  @Delete('rails/:id')
  async deleteRail(@Param('id') id: string): Promise<void> {
    await this.homeService.deleteRail(id);
  }
}
