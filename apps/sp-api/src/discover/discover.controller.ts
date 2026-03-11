import { Controller, Get } from '@nestjs/common';
import { DiscoverResponseDto } from './dto/discover-item.dto';
import { DiscoverService } from './discover.service';

@Controller('api/discover')
export class DiscoverController {
  constructor(private readonly discoverService: DiscoverService) {}

  @Get()
  getDiscoverFeed(): Promise<DiscoverResponseDto> {
    return this.discoverService.getDiscoverFeed();
  }
}
