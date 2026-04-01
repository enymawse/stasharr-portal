import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexingService } from '../../core/api/indexing.service';
import {
  IndexingJobStatusResponse,
  IndexingStatusResponse,
} from '../../core/api/indexing.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { IndexingSettingsPageComponent } from './indexing-settings-page.component';

function buildJob(
  jobName: string,
  overrides: Partial<IndexingJobStatusResponse> = {},
): IndexingJobStatusResponse {
  return {
    jobName,
    status: 'SUCCEEDED',
    startedAt: '2026-03-31T03:00:00.000Z',
    finishedAt: '2026-03-31T03:00:04.000Z',
    leaseUntil: null,
    cursor: null,
    lastError: null,
    lastSuccessAt: '2026-03-31T03:00:04.000Z',
    lastDurationMs: 4_000,
    processedCount: 12,
    updatedCount: 5,
    lastRunReason: 'interval',
    ...overrides,
  };
}

function buildStatus(overrides: Partial<IndexingStatusResponse> = {}): IndexingStatusResponse {
  return {
    totals: {
      indexedScenes: 240,
      acquisitionTrackedScenes: 28,
      metadataBacklogScenes: 9,
      metadataHydration: {
        pending: 7,
        retryable: 2,
      },
    },
    freshness: {
      indexStatusMaxAgeMs: 30 * 60_000,
      requestRowsFresh: true,
      whisparrMoviesFresh: true,
      stashAvailabilityFresh: false,
      canResolveUnknownScenesAsNotRequested: true,
      lastIndexWriteAt: '2026-03-31T03:00:04.000Z',
      acquisitionCountsSource: 'scene-index-summary',
    },
    jobs: [
      buildJob('scene-index-bootstrap', { status: 'IDLE', lastSuccessAt: null }),
      buildJob('scene-index-request-rows'),
      buildJob('scene-index-whisparr-queue'),
      buildJob('scene-index-whisparr-movies', {
        lastDurationMs: 9_000,
        processedCount: 48,
        updatedCount: 16,
      }),
      buildJob('scene-index-library-projection', {
        status: 'FAILED',
        lastError: 'Projection failed to write one row.',
      }),
      buildJob('scene-index-stash-availability', { status: 'IDLE', lastSuccessAt: null }),
      buildJob('scene-index-metadata-backfill', {
        status: 'RUNNING',
        finishedAt: null,
      }),
    ],
    ...overrides,
  };
}

describe('IndexingSettingsPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderPage(status = buildStatus()) {
    const indexingService = {
      getStatus: vi.fn().mockReturnValue(of(status)),
      sync: vi.fn().mockReturnValue(of(status)),
    };
    const notifications = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [IndexingSettingsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: IndexingService,
          useValue: indexingService,
        },
        {
          provide: AppNotificationsService,
          useValue: notifications,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(IndexingSettingsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, indexingService, notifications };
  }

  it('loads indexing status and renders summary and job details', async () => {
    const { fixture, indexingService } = await renderPage();
    const text = fixture.nativeElement.textContent;

    expect(indexingService.getStatus).toHaveBeenCalledTimes(1);
    expect(text).toContain('Indexing & Sync');
    expect(text).toContain('Sync All');
    expect(text).toContain('Whisparr Queue');
    expect(text).toContain('Every 30 seconds');
    expect(text).toContain('Projection failed to write one row.');
    expect(text).toContain('240');
    expect(
      fixture.nativeElement.querySelector('[data-testid="job-scene-index-whisparr-movies"]'),
    ).toBeTruthy();
  });

  it('triggers the correct per-job sync and disables the trigger while it is in flight', async () => {
    const syncResult$ = new Subject<IndexingStatusResponse>();
    const { fixture, indexingService, notifications } = await renderPage(
      buildStatus({
        jobs: [
          buildJob('scene-index-bootstrap', { status: 'IDLE', lastSuccessAt: null }),
          buildJob('scene-index-request-rows'),
          buildJob('scene-index-whisparr-queue'),
          buildJob('scene-index-whisparr-movies'),
          buildJob('scene-index-library-projection'),
          buildJob('scene-index-stash-availability', { status: 'IDLE', lastSuccessAt: null }),
          buildJob('scene-index-metadata-backfill', { status: 'IDLE' }),
        ],
      }),
    );
    indexingService.sync.mockReturnValue(syncResult$.asObservable());

    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="trigger-scene-index-whisparr-queue"]',
    ) as HTMLButtonElement | null;

    expect(trigger).toBeTruthy();

    trigger?.click();
    fixture.detectChanges();

    expect(indexingService.sync).toHaveBeenCalledWith('queue');
    expect(trigger?.disabled).toBe(true);

    syncResult$.next(buildStatus());
    syncResult$.complete();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(notifications.success).toHaveBeenCalledWith('Whisparr Queue finished');
  });

  it('triggers Sync All from the manual actions panel', async () => {
    const { fixture, indexingService } = await renderPage(
      buildStatus({
        jobs: [
          buildJob('scene-index-bootstrap', { status: 'IDLE', lastSuccessAt: null }),
          buildJob('scene-index-request-rows'),
          buildJob('scene-index-whisparr-queue'),
          buildJob('scene-index-whisparr-movies', { status: 'IDLE' }),
          buildJob('scene-index-library-projection', { status: 'IDLE' }),
          buildJob('scene-index-stash-availability', { status: 'IDLE', lastSuccessAt: null }),
          buildJob('scene-index-metadata-backfill', { status: 'IDLE' }),
        ],
      }),
    );

    const syncAllButton = fixture.nativeElement.querySelector(
      '[data-testid="sync-all"]',
    ) as HTMLButtonElement | null;

    syncAllButton?.click();
    fixture.detectChanges();

    expect(indexingService.sync).toHaveBeenCalledWith('all');
  });
});
