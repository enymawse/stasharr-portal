import { Body, Controller, Get, Put } from '@nestjs/common';
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
}
