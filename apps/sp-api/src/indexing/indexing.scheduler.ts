import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { IndexingService } from './indexing.service';

@Injectable()
export class IndexingScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexingScheduler.name);
  private readonly runningJobs = new Set<string>();

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
    if (this.runningJobs.has(jobName)) {
      this.logger.debug(`Skipping overlapping indexing job: ${jobName}`);
      this.logMemory(jobName, 'skipped-overlap');
      return;
    }

    this.runningJobs.add(jobName);
    const startedAt = Date.now();

    void task()
      .catch((error: unknown) => {
        this.logger.error(
          `Background indexing job failed: ${jobName}`,
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => {
        this.runningJobs.delete(jobName);
        this.logMemory(jobName, 'completed', Date.now() - startedAt);
      });
  }

  private logMemory(
    jobName: string,
    outcome: string,
    durationMs?: number,
  ): void {
    if (!this.isMemoryLoggingEnabled()) {
      return;
    }

    const memory = process.memoryUsage();
    const toMb = (bytes: number) => Math.round(bytes / 1024 ** 2);

    this.logger.debug(
      `[${jobName}] outcome=${outcome}${
        durationMs === undefined ? '' : ` durationMs=${durationMs}`
      } rss=${toMb(memory.rss)}MB heap=${toMb(memory.heapUsed)}/${toMb(
        memory.heapTotal,
      )}MB external=${toMb(memory.external)}MB arrayBuffers=${toMb(
        memory.arrayBuffers,
      )}MB`,
    );
  }

  private isMemoryLoggingEnabled(): boolean {
    return process.env.STASHARR_INDEXING_MEMORY_LOG === '1';
  }
}
