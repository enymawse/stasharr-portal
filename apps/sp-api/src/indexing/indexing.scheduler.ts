import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { IndexingService } from './indexing.service';

@Injectable()
export class IndexingScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexingScheduler.name);

  constructor(private readonly indexingService: IndexingService) {}

  onApplicationBootstrap(): void {
    this.runInBackground('bootstrap', () =>
      this.indexingService.bootstrapIndex('startup'),
    );
  }

  @Interval(30_000)
  handleWhisparrQueueSync(): void {
    this.runInBackground('whisparr-queue', () =>
      this.indexingService.syncWhisparrQueue('interval'),
    );
  }

  @Interval(15 * 60_000)
  handleWhisparrMovieSync(): void {
    this.runInBackground('whisparr-movies', () =>
      this.indexingService.syncWhisparrMovies('interval'),
    );
  }

  @Interval(5 * 60_000)
  handleLibraryProjectionSync(): void {
    this.runInBackground('library-projection', () =>
      this.indexingService.syncLibraryProjection('interval'),
    );
  }

  @Interval(10_000)
  handleMetadataBackfill(): void {
    this.runInBackground('metadata-backfill', () =>
      this.indexingService.syncMetadataBackfill('interval'),
    );
  }

  private runInBackground(jobName: string, task: () => Promise<unknown>): void {
    void task().catch((error: unknown) => {
      this.logger.error(
        `Background indexing job failed: ${jobName}`,
        error instanceof Error ? error.stack : undefined,
      );
    });
  }
}
