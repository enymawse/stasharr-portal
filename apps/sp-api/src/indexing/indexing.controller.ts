import { Controller, Get, Post, Query } from '@nestjs/common';
import { IndexingService } from './indexing.service';

@Controller('api/indexing')
export class IndexingController {
  constructor(private readonly indexingService: IndexingService) {}

  @Get('status')
  getStatus() {
    return this.indexingService.getSyncStatus();
  }

  @Post('sync')
  async syncNow(@Query('job') job?: string) {
    await this.indexingService.runManualSync(job);
    return this.indexingService.getSyncStatus();
  }
}
