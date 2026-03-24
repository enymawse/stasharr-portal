import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { CreateHomeRailDto, UpdateHomeRailDto } from './dto/create-home-rail.dto';
import { HomeRailDto } from './dto/home-rail.dto';
import { UpdateHomeRailsDto } from './dto/update-home-rails.dto';
import { HomeService } from './home.service';

@Controller('api/home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  @Get('rails')
  getRails(): Promise<HomeRailDto[]> {
    return this.homeService.getRails();
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
