import { Controller, Get } from '@nestjs/common';
import { DiscoverItemDto } from './dto/discover-item.dto';
import { DiscoverService } from './discover.service';

@Controller('api/discover')
export class DiscoverController {
  constructor(private readonly discoverService: DiscoverService) {}

  @Get()
  getDiscoverFeed(): Promise<DiscoverItemDto[]> {
    return this.discoverService.getDiscoverFeed();
  }
}
