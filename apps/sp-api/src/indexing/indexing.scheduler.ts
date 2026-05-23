import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { writeHeapSnapshot } from 'node:v8';
import {
  IndexingDiagnosticsSnapshot,
  IndexingService,
} from './indexing.service';

type MemoryUsageSnapshot = ReturnType<typeof process.memoryUsage>;

type DiagnosticValue = number | string | boolean | null;

interface JobResultTelemetry {
  processedCount?: number;
  updatedCount?: number;
  cursor?: string | null;
  diagnostics?: Record<string, DiagnosticValue>;
}

@Injectable()
export class IndexingScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexingScheduler.name);
  private readonly runningJobs = new Set<string>();
  private lastGcSampleAt = 0;
  private gcUnavailableLogged = false;
  private lastHeapSnapshotAt = 0;
  private heapSnapshotsWritten = 0;

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
      void this.logJobCompletion({
        jobName,
        outcome: 'skipped-overlap',
        durationMs: undefined,
        startMemory: null,
        result: null,
      });
      return;
    }

    this.runningJobs.add(jobName);
    const startedAt = Date.now();
    const startMemory = this.isAnyMemoryDiagnosticEnabled()
      ? process.memoryUsage()
      : null;
    let outcome = 'completed';
    let result: unknown = null;

    void task()
      .then((value) => {
        result = value;
      })
      .catch((error: unknown) => {
        outcome = 'failed';
        this.logger.error(
          `Background indexing job failed: ${jobName}`,
          error instanceof Error ? error.stack : undefined,
        );
      })
      .finally(() => {
        this.runningJobs.delete(jobName);
        void this.logJobCompletion({
          jobName,
          outcome,
          durationMs: Date.now() - startedAt,
          startMemory,
          result,
        }).catch((error: unknown) => {
          this.logger.warn(
            `Indexing memory diagnostics failed: ${this.safeJson(
              this.serializeError(error),
            )}`,
          );
        });
      });
  }

  private async logJobCompletion(input: {
    jobName: string;
    outcome: string;
    durationMs?: number;
    startMemory: MemoryUsageSnapshot | null;
    result: unknown;
  }): Promise<void> {
    if (!this.isAnyMemoryDiagnosticEnabled()) {
      return;
    }

    const endMemory = process.memoryUsage();
    const diagnostics = this.isMemoryLoggingEnabled()
      ? await this.getIndexingDiagnosticsSnapshot()
      : null;

    if (this.isMemoryLoggingEnabled()) {
      this.logger.log(
        this.buildMemoryLogLine({
          jobName: input.jobName,
          outcome: input.outcome,
          durationMs: input.durationMs,
          startMemory: input.startMemory,
          endMemory,
          result: input.result,
          diagnostics,
        }),
      );
    }

    this.maybeLogGcSample(input.jobName, endMemory);
    this.maybeWriteHeapSnapshot(input.jobName, endMemory);
  }

  private isMemoryLoggingEnabled(): boolean {
    return this.isEnvFlagEnabled('STASHARR_INDEXING_MEMORY_LOG');
  }

  private isGcLoggingEnabled(): boolean {
    return this.isEnvFlagEnabled('STASHARR_INDEXING_GC_LOG');
  }

  private isHeapSnapshotEnabled(): boolean {
    return this.isEnvFlagEnabled('STASHARR_INDEXING_HEAP_SNAPSHOT');
  }

  private isAnyMemoryDiagnosticEnabled(): boolean {
    return (
      this.isMemoryLoggingEnabled() ||
      this.isGcLoggingEnabled() ||
      this.isHeapSnapshotEnabled()
    );
  }

  private async getIndexingDiagnosticsSnapshot(): Promise<IndexingDiagnosticsSnapshot | null> {
    try {
      return await this.indexingService.getIndexingDiagnosticsSnapshot();
    } catch (error) {
      this.logger.warn(
        `Failed to collect indexing diagnostics snapshot: ${this.safeJson(
          this.serializeError(error),
        )}`,
      );
      return null;
    }
  }

  private buildMemoryLogLine(input: {
    jobName: string;
    outcome: string;
    durationMs?: number;
    startMemory: MemoryUsageSnapshot | null;
    endMemory: MemoryUsageSnapshot;
    result: unknown;
    diagnostics: IndexingDiagnosticsSnapshot | null;
  }): string {
    const fields: Record<string, DiagnosticValue> = {
      outcome: input.outcome,
      ...(input.durationMs === undefined
        ? {}
        : {
            durationMs: input.durationMs,
          }),
      rss: `${this.toMb(input.endMemory.rss)}MB`,
      heap: `${this.toMb(input.endMemory.heapUsed)}/${this.toMb(
        input.endMemory.heapTotal,
      )}MB`,
      external: `${this.toMb(input.endMemory.external)}MB`,
      arrayBuffers: `${this.toMb(input.endMemory.arrayBuffers)}MB`,
      heapRssRatio: this.formatRatio(
        input.endMemory.heapUsed,
        input.endMemory.rss,
      ),
      ...this.buildMemoryDeltaFields(input.startMemory, input.endMemory),
      ...this.buildResultFields(input.result),
      ...this.buildIndexingDiagnosticFields(input.diagnostics),
    };

    return `[${input.jobName}] ${this.formatFields(fields)}`;
  }

  private buildMemoryDeltaFields(
    startMemory: MemoryUsageSnapshot | null,
    endMemory: MemoryUsageSnapshot,
  ): Record<string, DiagnosticValue> {
    if (!startMemory) {
      return {};
    }

    return {
      rssStart: `${this.toMb(startMemory.rss)}MB`,
      rssDelta: this.formatSignedMb(endMemory.rss - startMemory.rss),
      heapStart: `${this.toMb(startMemory.heapUsed)}MB`,
      heapDelta: this.formatSignedMb(endMemory.heapUsed - startMemory.heapUsed),
      heapTotalDelta: this.formatSignedMb(
        endMemory.heapTotal - startMemory.heapTotal,
      ),
      externalDelta: this.formatSignedMb(
        endMemory.external - startMemory.external,
      ),
      arrayBuffersDelta: this.formatSignedMb(
        endMemory.arrayBuffers - startMemory.arrayBuffers,
      ),
    };
  }

  private buildResultFields(result: unknown): Record<string, DiagnosticValue> {
    const telemetry = this.toJobResultTelemetry(result);
    if (!telemetry) {
      return {};
    }

    const fields: Record<string, DiagnosticValue> = {};
    if (typeof telemetry.processedCount === 'number') {
      fields.resultProcessed = telemetry.processedCount;
    }
    if (typeof telemetry.updatedCount === 'number') {
      fields.resultUpdated = telemetry.updatedCount;
    }
    if (telemetry.cursor !== undefined) {
      fields.resultCursor = telemetry.cursor;
    }

    for (const [key, value] of Object.entries(telemetry.diagnostics ?? {})) {
      fields[`diag${this.capitalize(key)}`] = value;
    }

    return fields;
  }

  private buildIndexingDiagnosticFields(
    diagnostics: IndexingDiagnosticsSnapshot | null,
  ): Record<string, DiagnosticValue> {
    if (!diagnostics) {
      return {};
    }

    return {
      indexTotal: diagnostics.indexedScenes,
      acquisitionTracked: diagnostics.acquisitionTrackedScenes,
      requested: diagnostics.requestedCount,
      downloading: diagnostics.downloadingCount,
      importPending: diagnostics.importPendingCount,
      failed: diagnostics.failedCount,
      metadataPending: diagnostics.metadataPendingCount,
      metadataRetryable: diagnostics.metadataRetryableCount,
      metadataHydrated: diagnostics.metadataHydratedCount,
      metadataBacklog: diagnostics.metadataBacklogCount,
      inFlightMetadata: diagnostics.metadataHydrationInFlightCount,
    };
  }

  private maybeLogGcSample(
    jobName: string,
    beforeMemory: MemoryUsageSnapshot,
  ): void {
    if (!this.isGcLoggingEnabled()) {
      return;
    }

    const now = Date.now();
    const sampleIntervalMs = this.readNonNegativeIntegerEnv(
      'STASHARR_INDEXING_GC_SAMPLE_INTERVAL_MS',
      15 * 60_000,
    );
    if (
      this.lastGcSampleAt > 0 &&
      now - this.lastGcSampleAt < sampleIntervalMs
    ) {
      return;
    }
    this.lastGcSampleAt = now;

    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc !== 'function') {
      if (!this.gcUnavailableLogged) {
        this.gcUnavailableLogged = true;
        this.logger.warn(
          'STASHARR_INDEXING_GC_LOG is enabled, but global.gc is unavailable. Start Node with --expose-gc to collect GC-assisted telemetry.',
        );
      }
      return;
    }

    const startedAt = Date.now();
    gc();
    const afterMemory = process.memoryUsage();
    this.logger.log(
      `[memory-gc] ${this.formatFields({
        job: jobName,
        durationMs: Date.now() - startedAt,
        rssBefore: `${this.toMb(beforeMemory.rss)}MB`,
        rssAfter: `${this.toMb(afterMemory.rss)}MB`,
        rssDelta: this.formatSignedMb(afterMemory.rss - beforeMemory.rss),
        heapBefore: `${this.toMb(beforeMemory.heapUsed)}MB`,
        heapAfter: `${this.toMb(afterMemory.heapUsed)}MB`,
        heapDelta: this.formatSignedMb(
          afterMemory.heapUsed - beforeMemory.heapUsed,
        ),
        heapTotalBefore: `${this.toMb(beforeMemory.heapTotal)}MB`,
        heapTotalAfter: `${this.toMb(afterMemory.heapTotal)}MB`,
        heapTotalDelta: this.formatSignedMb(
          afterMemory.heapTotal - beforeMemory.heapTotal,
        ),
      })}`,
    );
  }

  private maybeWriteHeapSnapshot(
    jobName: string,
    memory: MemoryUsageSnapshot,
  ): void {
    if (!this.isHeapSnapshotEnabled()) {
      return;
    }

    const heapUsedMb = this.toMb(memory.heapUsed);
    const minHeapMb = this.readNonNegativeIntegerEnv(
      'STASHARR_INDEXING_HEAP_SNAPSHOT_MIN_HEAP_MB',
      512,
    );
    if (heapUsedMb < minHeapMb) {
      return;
    }

    const maxSnapshots = this.readNonNegativeIntegerEnv(
      'STASHARR_INDEXING_HEAP_SNAPSHOT_MAX_COUNT',
      4,
    );
    if (this.heapSnapshotsWritten >= maxSnapshots) {
      return;
    }

    const now = Date.now();
    const minIntervalMs = this.readNonNegativeIntegerEnv(
      'STASHARR_INDEXING_HEAP_SNAPSHOT_MIN_INTERVAL_MS',
      30 * 60_000,
    );
    if (
      this.lastHeapSnapshotAt > 0 &&
      now - this.lastHeapSnapshotAt < minIntervalMs
    ) {
      return;
    }

    const snapshotDir =
      process.env.STASHARR_INDEXING_HEAP_SNAPSHOT_DIR?.trim() ||
      '/tmp/stasharr-heap-snapshots';
    const safeJobName = jobName.replace(/[^a-zA-Z0-9._-]/g, '-');
    const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    const fileName = `stasharr-${timestamp}-${safeJobName}-${heapUsedMb}MB.heapsnapshot`;

    try {
      mkdirSync(snapshotDir, {
        recursive: true,
      });
      const path = writeHeapSnapshot(join(snapshotDir, fileName));
      this.lastHeapSnapshotAt = now;
      this.heapSnapshotsWritten += 1;
      this.logger.log(
        `[heap-snapshot] ${this.formatFields({
          job: jobName,
          path,
          heap: `${heapUsedMb}MB`,
          rss: `${this.toMb(memory.rss)}MB`,
          snapshotsWritten: this.heapSnapshotsWritten,
          maxSnapshots,
        })}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to write heap snapshot: ${this.safeJson(
          this.serializeError(error),
        )}`,
      );
    }
  }

  private toJobResultTelemetry(result: unknown): JobResultTelemetry | null {
    if (!result || typeof result !== 'object') {
      return null;
    }

    return result as JobResultTelemetry;
  }

  private formatFields(fields: Record<string, DiagnosticValue>): string {
    return Object.entries(fields)
      .filter(
        (entry): entry is [string, DiagnosticValue] => entry[1] !== undefined,
      )
      .map(([key, value]) => `${key}=${this.formatFieldValue(value)}`)
      .join(' ');
  }

  private formatFieldValue(value: DiagnosticValue): string {
    if (value === null) {
      return 'null';
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    return String(value).replace(/\s/g, '_');
  }

  private formatRatio(numerator: number, denominator: number): string {
    if (denominator <= 0) {
      return '0.000';
    }

    return (numerator / denominator).toFixed(3);
  }

  private formatSignedMb(bytes: number): string {
    const mb = this.toMb(bytes);
    return `${mb >= 0 ? '+' : ''}${mb}MB`;
  }

  private toMb(bytes: number): number {
    return Math.round(bytes / 1024 ** 2);
  }

  private capitalize(value: string): string {
    return value.length === 0
      ? value
      : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  }

  private isEnvFlagEnabled(name: string): boolean {
    const raw = process.env[name]?.trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }

  private readNonNegativeIntegerEnv(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) {
      return fallback;
    }

    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  private safeJson(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return {
      message: String(error),
    };
  }
}
