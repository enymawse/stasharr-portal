import { Logger } from '@nestjs/common';
import { IndexingService } from './indexing.service';
import { IndexingScheduler } from './indexing.scheduler';

function createIndexingServiceMock(): jest.Mocked<
  Pick<
    IndexingService,
    | 'bootstrapIndex'
    | 'syncWhisparrQueue'
    | 'syncWhisparrMovies'
    | 'syncLibraryProjection'
    | 'syncMetadataBackfill'
  >
> {
  return {
    bootstrapIndex: jest.fn().mockResolvedValue(null),
    syncWhisparrQueue: jest.fn().mockResolvedValue(null),
    syncWhisparrMovies: jest.fn().mockResolvedValue(null),
    syncLibraryProjection: jest.fn().mockResolvedValue(null),
    syncMetadataBackfill: jest.fn().mockResolvedValue(null),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('IndexingScheduler', () => {
  const originalMemoryLog = process.env.STASHARR_INDEXING_MEMORY_LOG;

  afterEach(() => {
    if (originalMemoryLog === undefined) {
      delete process.env.STASHARR_INDEXING_MEMORY_LOG;
    } else {
      process.env.STASHARR_INDEXING_MEMORY_LOG = originalMemoryLog;
    }
    jest.restoreAllMocks();
  });

  it('skips overlapping runs of the same in-process job', async () => {
    const debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    let releaseFirstRun!: () => void;
    const firstRun = new Promise<null>((resolve) => {
      releaseFirstRun = () => resolve(null);
    });
    const indexingService = createIndexingServiceMock();
    indexingService.syncMetadataBackfill.mockReturnValueOnce(firstRun);
    const scheduler = new IndexingScheduler(
      indexingService as unknown as IndexingService,
    );

    scheduler.handleMetadataBackfill();
    scheduler.handleMetadataBackfill();

    expect(indexingService.syncMetadataBackfill).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(
      'Skipping overlapping indexing job: metadata-backfill',
    );

    releaseFirstRun();
    await firstRun;
    await flushPromises();

    scheduler.handleMetadataBackfill();

    expect(indexingService.syncMetadataBackfill).toHaveBeenCalledTimes(2);
  });

  it('logs memory usage for scheduler jobs when enabled', async () => {
    process.env.STASHARR_INDEXING_MEMORY_LOG = '1';
    const debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 101 * 1024 ** 2,
      heapTotal: 40 * 1024 ** 2,
      heapUsed: 20 * 1024 ** 2,
      external: 3 * 1024 ** 2,
      arrayBuffers: 2 * 1024 ** 2,
    });
    const indexingService = createIndexingServiceMock();
    const scheduler = new IndexingScheduler(
      indexingService as unknown as IndexingService,
    );

    scheduler.handleMetadataBackfill();
    await flushPromises();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metadata-backfill] outcome=completed'),
    );
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('rss=101MB'));
    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('heap=20/40MB'),
    );
  });

  it('logs failed outcome when a scheduler job rejects', async () => {
    process.env.STASHARR_INDEXING_MEMORY_LOG = '1';
    const debugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 101 * 1024 ** 2,
      heapTotal: 40 * 1024 ** 2,
      heapUsed: 20 * 1024 ** 2,
      external: 3 * 1024 ** 2,
      arrayBuffers: 2 * 1024 ** 2,
    });
    const indexingService = createIndexingServiceMock();
    indexingService.syncMetadataBackfill.mockRejectedValueOnce(
      new Error('metadata failed'),
    );
    const scheduler = new IndexingScheduler(
      indexingService as unknown as IndexingService,
    );

    scheduler.handleMetadataBackfill();
    await flushPromises();

    expect(debugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metadata-backfill] outcome=failed'),
    );
  });
});
