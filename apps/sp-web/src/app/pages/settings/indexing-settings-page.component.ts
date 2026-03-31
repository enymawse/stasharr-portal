import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { IndexingService } from '../../core/api/indexing.service';
import {
  IndexingJobStatus,
  IndexingJobStatusResponse,
  IndexingStatusResponse,
  ManualIndexingSyncJob,
} from '../../core/api/indexing.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';

interface JobDefinition {
  label: string;
  purpose: string;
  cadence: string;
  triggerJob: Exclude<ManualIndexingSyncJob, 'all'> | null;
}

interface FreshnessCheck {
  label: string;
  ok: boolean;
}

interface HealthSummary {
  label: string;
  tone: 'good' | 'warn' | 'info';
  description: string;
}

type IndexingJobView = IndexingJobStatusResponse & JobDefinition;

const INDEXING_JOB_DEFINITIONS: Record<string, JobDefinition> = {
  'scene-index-bootstrap': {
    label: 'Bootstrap',
    purpose: 'Seeds request rows and downstream projections when the app starts or a full catch-up is needed.',
    cadence: 'On startup and during Sync All',
    triggerJob: null,
  },
  'scene-index-request-rows': {
    label: 'Request Rows',
    purpose: 'Projects request table status into indexed scene state used across the app.',
    cadence: 'Runs during full syncs and targeted refreshes',
    triggerJob: null,
  },
  'scene-index-whisparr-queue': {
    label: 'Whisparr Queue',
    purpose: 'Refreshes active queue state so download and import overlays stay current.',
    cadence: 'Every 30 seconds',
    triggerJob: 'queue',
  },
  'scene-index-whisparr-movies': {
    label: 'Whisparr Movies',
    purpose: 'Refreshes Whisparr movie presence and file state for indexed scenes.',
    cadence: 'Every 15 minutes',
    triggerJob: 'movies',
  },
  'scene-index-library-projection': {
    label: 'Library Projection',
    purpose: 'Projects the local library and availability bridge that powers the Library view.',
    cadence: 'Every 5 minutes',
    triggerJob: 'library',
  },
  'scene-index-stash-availability': {
    label: 'Stash Availability',
    purpose: 'Updates availability bridging after local-library changes and targeted refreshes.',
    cadence: 'Runs with library projection and targeted refreshes',
    triggerJob: null,
  },
  'scene-index-metadata-backfill': {
    label: 'Metadata Backfill',
    purpose: 'Hydrates missing titles, images, studios, and related metadata over time.',
    cadence: 'Every 10 seconds with backlog, otherwise every 30 minutes',
    triggerJob: 'metadata',
  },
};

@Component({
  selector: 'app-indexing-settings-page',
  imports: [RouterLink, ButtonDirective, Message, ProgressSpinner],
  templateUrl: './indexing-settings-page.component.html',
  styleUrl: './indexing-settings-page.component.scss',
})
export class IndexingSettingsPageComponent implements OnInit {
  private readonly indexingService = inject(IndexingService);
  private readonly notifications = inject(AppNotificationsService);

  protected readonly loading = signal(true);
  protected readonly refreshing = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly actionSuccess = signal<string | null>(null);
  protected readonly status = signal<IndexingStatusResponse | null>(null);
  protected readonly triggeringAction = signal<ManualIndexingSyncJob | null>(null);

  protected readonly jobViews = computed<IndexingJobView[]>(() =>
    (this.status()?.jobs ?? []).map((job) => ({
      ...job,
      ...this.definitionForJob(job.jobName),
    })),
  );

  protected readonly freshnessChecks = computed<FreshnessCheck[]>(() => {
    const status = this.status();
    if (!status) {
      return [];
    }

    return [
      {
        label: 'Request rows are fresh',
        ok: status.freshness.requestRowsFresh,
      },
      {
        label: 'Whisparr movie snapshots are fresh',
        ok: status.freshness.whisparrMoviesFresh,
      },
      {
        label: 'Library availability is fresh',
        ok: status.freshness.stashAvailabilityFresh,
      },
      {
        label: 'Unknown scenes can resolve to not requested',
        ok: status.freshness.canResolveUnknownScenesAsNotRequested,
      },
    ];
  });

  protected readonly healthSummary = computed<HealthSummary>(() => {
    const status = this.status();
    if (!status) {
      return {
        label: 'Unknown',
        tone: 'info',
        description: 'Indexing status is not loaded yet.',
      };
    }

    if (this.jobViews().some((job) => job.status === 'RUNNING')) {
      return {
        label: 'Sync In Progress',
        tone: 'info',
        description: 'One or more jobs are running. Refresh after the current pass completes for the latest snapshot.',
      };
    }

    if (
      status.freshness.requestRowsFresh &&
      status.freshness.whisparrMoviesFresh &&
      status.freshness.stashAvailabilityFresh
    ) {
      return {
        label: 'Fresh',
        tone: 'good',
        description: 'Acquisition, Library, and status overlays are backed by recent sync data.',
      };
    }

    return {
      label: 'Needs Attention',
      tone: 'warn',
      description: 'At least one freshness signal is stale or a recent job failed.',
    };
  });

  ngOnInit(): void {
    this.loadStatus();
  }

  protected refreshStatus(): void {
    if (this.loading() || this.refreshing() || this.triggeringAction()) {
      return;
    }

    this.refreshing.set(true);
    this.actionError.set(null);

    this.indexingService
      .getStatus()
      .pipe(
        finalize(() => {
          this.refreshing.set(false);
        }),
      )
      .subscribe({
        next: (status) => {
          this.status.set(status);
        },
        error: () => {
          this.actionError.set('Failed to refresh indexing status.');
        },
      });
  }

  protected retryLoad(): void {
    if (this.loading() || this.triggeringAction()) {
      return;
    }

    this.loadStatus();
  }

  protected syncAll(): void {
    this.runSync('all', 'Sync All');
  }

  protected triggerJob(job: IndexingJobView): void {
    if (!job.triggerJob) {
      return;
    }

    this.runSync(job.triggerJob, job.label);
  }

  protected formatStatus(status: IndexingJobStatus): string {
    switch (status) {
      case 'RUNNING':
        return 'Running';
      case 'SUCCEEDED':
        return 'Succeeded';
      case 'FAILED':
        return 'Failed';
      case 'IDLE':
      default:
        return 'Idle';
    }
  }

  protected formatDateTime(value: string | null, fallback = 'Never'): string {
    if (!value) {
      return fallback;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  }

  protected formatDuration(value: number | null): string {
    if (value === null) {
      return 'n/a';
    }

    if (value < 1_000) {
      return `${value} ms`;
    }

    const totalSeconds = Math.round(value / 1_000);
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
      return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  protected formatCount(value: number | null): string {
    return value === null ? 'n/a' : value.toLocaleString();
  }

  protected formatRunReason(value: string | null): string {
    if (!value) {
      return 'n/a';
    }

    return value.replaceAll('-', ' ').replaceAll(':', ' / ');
  }

  protected isSyncAllDisabled(): boolean {
    return this.loading() || this.refreshing() || this.triggeringAction() !== null;
  }

  protected isJobTriggerDisabled(job: IndexingJobView): boolean {
    return (
      !job.triggerJob ||
      job.status === 'RUNNING' ||
      this.loading() ||
      this.refreshing() ||
      this.triggeringAction() !== null
    );
  }

  protected triggerLabel(job: IndexingJobView): string {
    return this.triggeringAction() === job.triggerJob ? 'Syncing...' : 'Sync now';
  }

  private loadStatus(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.indexingService
      .getStatus()
      .pipe(
        finalize(() => {
          this.loading.set(false);
        }),
      )
      .subscribe({
        next: (status) => {
          this.status.set(status);
        },
        error: () => {
          this.loadError.set('Failed to load indexing status from the API.');
        },
      });
  }

  private runSync(job: ManualIndexingSyncJob, label: string): void {
    if (this.triggeringAction() !== null) {
      return;
    }

    this.triggeringAction.set(job);
    this.actionError.set(null);
    this.actionSuccess.set(null);

    this.indexingService
      .sync(job)
      .pipe(
        finalize(() => {
          this.triggeringAction.set(null);
        }),
      )
      .subscribe({
        next: (status) => {
          this.status.set(status);
          this.actionSuccess.set(`${label} finished and indexing status was refreshed.`);
          this.notifications.success(`${label} finished`);
        },
        error: () => {
          this.actionError.set(`Failed to trigger ${label}.`);
          this.notifications.error(`Failed to trigger ${label}`);
        },
      });
  }

  private definitionForJob(jobName: string): JobDefinition {
    return (
      INDEXING_JOB_DEFINITIONS[jobName] ?? {
        label: this.humanizeJobName(jobName),
        purpose: 'Background job details are available, but no specific description is defined yet.',
        cadence: 'Internal cadence',
        triggerJob: null,
      }
    );
  }

  private humanizeJobName(jobName: string): string {
    return jobName
      .replace(/^scene-index-/, '')
      .split('-')
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(' ');
  }
}
