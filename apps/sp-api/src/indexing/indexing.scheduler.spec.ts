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
    | 'getIndexingDiagnosticsSnapshot'
  >
> {
  return {
    bootstrapIndex: jest.fn().mockResolvedValue(null),
    syncWhisparrQueue: jest.fn().mockResolvedValue(null),
    syncWhisparrMovies: jest.fn().mockResolvedValue(null),
    syncLibraryProjection: jest.fn().mockResolvedValue(null),
    syncMetadataBackfill: jest.fn().mockResolvedValue(null),
    getIndexingDiagnosticsSnapshot: jest.fn().mockResolvedValue({
      indexedScenes: 10,
      acquisitionTrackedScenes: 4,
      requestedCount: 1,
      downloadingCount: 1,
      importPendingCount: 1,
      failedCount: 1,
      metadataPendingCount: 2,
      metadataRetryableCount: 1,
      metadataHydratedCount: 7,
      metadataBacklogCount: 3,
      metadataHydrationInFlightCount: 0,
      lastIndexWriteAt: null,
    }),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

describe('IndexingScheduler', () => {
  const trackedEnvKeys = [
    'STASHARR_INDEXING_MEMORY_LOG',
    'STASHARR_INDEXING_GC_LOG',
    'STASHARR_INDEXING_GC_SAMPLE_INTERVAL_MS',
    'STASHARR_INDEXING_HEAP_SNAPSHOT',
    'STASHARR_INDEXING_HEAP_SNAPSHOT_MIN_HEAP_MB',
    'STASHARR_INDEXING_HEAP_SNAPSHOT_MIN_INTERVAL_MS',
    'STASHARR_INDEXING_HEAP_SNAPSHOT_MAX_COUNT',
    'STASHARR_INDEXING_HEAP_SNAPSHOT_DIR',
  ] as const;
  const originalEnv = Object.fromEntries(
    trackedEnvKeys.map((key) => [key, process.env[key]]),
  );

  afterEach(() => {
    for (const key of trackedEnvKeys) {
      const originalValue = originalEnv[key];
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
    delete (globalThis as { gc?: () => void }).gc;
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
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    jest
      .spyOn(process, 'memoryUsage')
      .mockReturnValueOnce({
        rss: 100 * 1024 ** 2,
        heapTotal: 40 * 1024 ** 2,
        heapUsed: 18 * 1024 ** 2,
        external: 3 * 1024 ** 2,
        arrayBuffers: 2 * 1024 ** 2,
      })
      .mockReturnValue({
        rss: 101 * 1024 ** 2,
        heapTotal: 41 * 1024 ** 2,
        heapUsed: 20 * 1024 ** 2,
        external: 4 * 1024 ** 2,
        arrayBuffers: 2 * 1024 ** 2,
      });
    const indexingService = createIndexingServiceMock();
    indexingService.syncMetadataBackfill.mockResolvedValueOnce({
      processedCount: 7,
      updatedCount: 6,
      diagnostics: {
        metadataTargets: 7,
      },
    });
    const scheduler = new IndexingScheduler(
      indexingService as unknown as IndexingService,
    );

    scheduler.handleMetadataBackfill();
    await flushPromises();

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metadata-backfill] outcome=completed'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('rss=101MB'));
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('heap=20/41MB'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('rssDelta=+1MB'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('heapDelta=+2MB'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('resultProcessed=7'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('diagMetadataTargets=7'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('indexTotal=10'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('metadataBacklog=3'),
    );
  });

  it('logs failed outcome when a scheduler job rejects', async () => {
    process.env.STASHARR_INDEXING_MEMORY_LOG = '1';
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
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

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[metadata-backfill] outcome=failed'),
    );
  });

  it('logs GC-assisted memory samples when enabled and gc is exposed', async () => {
    process.env.STASHARR_INDEXING_GC_LOG = '1';
    process.env.STASHARR_INDEXING_GC_SAMPLE_INTERVAL_MS = '0';
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const gcMock = jest.fn();
    (globalThis as { gc?: () => void }).gc = gcMock;
    jest
      .spyOn(process, 'memoryUsage')
      .mockReturnValueOnce({
        rss: 101 * 1024 ** 2,
        heapTotal: 50 * 1024 ** 2,
        heapUsed: 40 * 1024 ** 2,
        external: 3 * 1024 ** 2,
        arrayBuffers: 2 * 1024 ** 2,
      })
      .mockReturnValueOnce({
        rss: 110 * 1024 ** 2,
        heapTotal: 55 * 1024 ** 2,
        heapUsed: 45 * 1024 ** 2,
        external: 3 * 1024 ** 2,
        arrayBuffers: 2 * 1024 ** 2,
      })
      .mockReturnValue({
        rss: 105 * 1024 ** 2,
        heapTotal: 45 * 1024 ** 2,
        heapUsed: 30 * 1024 ** 2,
        external: 3 * 1024 ** 2,
        arrayBuffers: 2 * 1024 ** 2,
      });
    const indexingService = createIndexingServiceMock();
    const scheduler = new IndexingScheduler(
      indexingService as unknown as IndexingService,
    );

    scheduler.handleMetadataBackfill();
    await flushPromises();

    expect(gcMock).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('[memory-gc] job=metadata-backfill'),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('heapDelta=-15MB'),
    );
  });
});
