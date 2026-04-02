import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, finalize, of, Subscription } from 'rxjs';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { AcquisitionService } from '../../core/api/acquisition.service';
import {
  AcquisitionCountsByLifecycle,
  AcquisitionLifecycleFilter,
  AcquisitionLifecycleState,
  AcquisitionSceneItem,
} from '../../core/api/acquisition.types';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import {
  RuntimeHealthResponse,
  summarizeRuntimeDegradedState,
} from '../../core/api/runtime-health.types';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { summarizeDegradedSetupState } from '../../core/api/setup.types';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

type AcquisitionSectionTone = 'attention' | 'pending' | 'active' | 'passive' | 'overview';

interface AcquisitionSummaryCard {
  lifecycle: AcquisitionLifecycleFilter;
  label: string;
  count: number;
  description: string;
  tone: AcquisitionSectionTone;
}

interface AcquisitionSectionView {
  lifecycle: AcquisitionLifecycleState;
  label: string;
  description: string;
  tone: Exclude<AcquisitionSectionTone, 'overview'>;
  totalCount: number;
  items: AcquisitionSceneItem[];
}

interface AcquisitionPageAlert {
  eyebrow: string;
  title: string;
  message: string;
}

@Component({
  selector: 'app-acquisition-page',
  imports: [RouterLink, Message, ProgressSpinner, SceneStatusBadgeComponent],
  templateUrl: './acquisition-page.component.html',
  styleUrl: './acquisition-page.component.scss',
})
export class AcquisitionPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PAGE_SIZE = 24;
  private static readonly EMPTY_COUNTS: AcquisitionCountsByLifecycle = {
    REQUESTED: 0,
    DOWNLOADING: 0,
    IMPORT_PENDING: 0,
    FAILED: 0,
  };
  private static readonly LIFECYCLE_ORDER: AcquisitionLifecycleState[] = [
    'FAILED',
    'IMPORT_PENDING',
    'DOWNLOADING',
    'REQUESTED',
  ];

  private readonly acquisitionService = inject(AcquisitionService);
  private readonly runtimeHealthService = inject(RuntimeHealthService);
  private readonly setupStatusStore = inject(SetupStatusStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private queryParamSubscription: Subscription | null = null;
  private observer: IntersectionObserver | null = null;
  private sentinelElement: HTMLDivElement | null = null;
  private sentinelIntersecting = false;
  private feedVersion = 0;
  private pendingReload = false;
  private hasHydratedFromUrl = false;

  @ViewChild('loadMoreSentinel')
  set loadMoreSentinel(elementRef: ElementRef<HTMLDivElement> | undefined) {
    const nextElement = elementRef?.nativeElement ?? null;
    if (this.sentinelElement === nextElement) {
      return;
    }

    if (this.observer && this.sentinelElement) {
      this.observer.unobserve(this.sentinelElement);
    }

    this.sentinelElement = nextElement;

    if (this.observer && this.sentinelElement) {
      this.observer.observe(this.sentinelElement);
    }
  }

  protected readonly loading = signal(false);
  protected readonly loadingMore = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loadMoreError = signal<string | null>(null);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly hasMore = signal(true);
  protected readonly inFlight = signal(false);
  protected readonly items = signal<AcquisitionSceneItem[]>([]);
  protected readonly runtimeHealth = signal<RuntimeHealthResponse | null>(null);
  protected readonly selectedLifecycle = signal<AcquisitionLifecycleFilter>('ANY');
  protected readonly countsByLifecycle = signal<AcquisitionCountsByLifecycle>(
    AcquisitionPageComponent.EMPTY_COUNTS,
  );
  protected readonly summaryCards = computed<AcquisitionSummaryCard[]>(() => {
    const totalTracked = this.countForLifecycle('ANY');
    const failedCount = this.countForLifecycle('FAILED');

    return [
      {
        lifecycle: 'ANY',
        label: 'All Tracked',
        count: totalTracked,
        description:
          totalTracked === 0
            ? 'Nothing is moving through acquisition right now.'
            : failedCount > 0
              ? `${this.countLabel(failedCount, 'scene')} need attention before the rest.`
              : 'Imported scenes leave this page and continue in Library.',
        tone: 'overview',
      },
      {
        lifecycle: 'FAILED',
        label: 'Failed',
        count: this.countForLifecycle('FAILED'),
        description: 'Problems that need recovery or a retry in Whisparr.',
        tone: 'attention',
      },
      {
        lifecycle: 'IMPORT_PENDING',
        label: 'Awaiting Import',
        count: this.countForLifecycle('IMPORT_PENDING'),
        description: 'Downloaded in Whisparr and waiting to show up in Stash.',
        tone: 'pending',
      },
      {
        lifecycle: 'DOWNLOADING',
        label: 'Downloading',
        count: this.countForLifecycle('DOWNLOADING'),
        description: 'Active queue work currently in progress.',
        tone: 'active',
      },
      {
        lifecycle: 'REQUESTED',
        label: 'Requested',
        count: this.countForLifecycle('REQUESTED'),
        description: 'Tracked in Whisparr and still waiting to start.',
        tone: 'passive',
      },
    ];
  });
  protected readonly visibleSections = computed<AcquisitionSectionView[]>(() => {
    const items = this.items();
    const selectedLifecycle = this.selectedLifecycle();

    if (selectedLifecycle !== 'ANY') {
      return [
        this.buildSection(
          selectedLifecycle,
          items,
          this.countForLifecycle(selectedLifecycle),
        ),
      ];
    }

    return AcquisitionPageComponent.LIFECYCLE_ORDER.map((lifecycle) =>
      this.buildSection(
        lifecycle,
        items.filter((item) => item.status.state === lifecycle),
        this.countForLifecycle(lifecycle),
      ),
    ).filter((section) => section.items.length > 0);
  });
  protected readonly pageAlert = computed<AcquisitionPageAlert | null>(() => {
    const setupState = summarizeDegradedSetupState(this.setupStatusStore.status());
    if (setupState) {
      const alert = this.buildDegradedAlert(
        setupState.services.map((service) => service.key),
        'setup',
      );
      if (alert) {
        return alert;
      }
    }

    const runtimeState = summarizeRuntimeDegradedState(
      this.runtimeHealth(),
      this.setupStatusStore.status()?.catalogProvider ?? null,
    );
    if (!runtimeState) {
      return null;
    }

    return this.buildDegradedAlert(
      runtimeState.services.map((service) => service.key),
      'runtime',
    );
  });

  ngOnInit(): void {
    this.setupUrlStateSync();
    this.loadRuntimeHealth();
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    if (this.observer && this.sentinelElement) {
      this.observer.unobserve(this.sentinelElement);
    }
    this.observer?.disconnect();
    this.queryParamSubscription?.unsubscribe();
  }

  protected hasItems(): boolean {
    return this.items().length > 0;
  }

  protected retryInitialLoad(): void {
    if (this.inFlight()) {
      return;
    }

    this.loadRuntimeHealth();
    this.error.set(null);
    this.loadNextPage();
  }

  protected retryLoadMore(): void {
    if (this.inFlight() || !this.hasMore()) {
      return;
    }

    this.loadMoreError.set(null);
    this.loadNextPage();
  }

  protected selectLifecycle(next: AcquisitionLifecycleFilter): void {
    if (this.selectedLifecycle() === next) {
      return;
    }

    this.selectedLifecycle.set(next);
    this.syncUrlWithCurrentFilter(false);
    this.resetFeedAndReload();
  }

  protected countForLifecycle(lifecycle: AcquisitionLifecycleFilter): number {
    const counts = this.countsByLifecycle();

    switch (lifecycle) {
      case 'REQUESTED':
        return counts.REQUESTED;
      case 'DOWNLOADING':
        return counts.DOWNLOADING;
      case 'IMPORT_PENDING':
        return counts.IMPORT_PENDING;
      case 'FAILED':
        return counts.FAILED;
      case 'ANY':
      default:
        return counts.REQUESTED + counts.DOWNLOADING + counts.IMPORT_PENDING + counts.FAILED;
    }
  }

  protected pageSummaryText(): string {
    const totalTracked = this.countForLifecycle('ANY');
    const failedCount = this.countForLifecycle('FAILED');
    const selectedLifecycle = this.selectedLifecycle();

    if (selectedLifecycle === 'ANY') {
      if (totalTracked === 0) {
        return 'Nothing is active right now. New requests begin in Scenes and completed imports continue in Library.';
      }

      if (failedCount > 0) {
        return `${this.countLabel(failedCount, 'scene')} need attention first. The remaining sections show what is still progressing normally.`;
      }

      return `${this.countLabel(totalTracked, 'scene')} are moving through Whisparr and toward your library right now.`;
    }

    return `${this.total()} ${this.filterLabel(selectedLifecycle).toLowerCase()} scenes match the current focus.`;
  }

  protected sectionIntroTitle(): string {
    const selectedLifecycle = this.selectedLifecycle();

    if (selectedLifecycle === 'ANY') {
      return 'Look here first, then work down the pipeline';
    }

    return `${this.filterLabel(selectedLifecycle)} focus`;
  }

  protected sectionIntroCopy(): string {
    const selectedLifecycle = this.selectedLifecycle();

    if (selectedLifecycle === 'ANY') {
      return 'Failed scenes surface first, then import handoff work, active downloads, and passive queued requests.';
    }

    return this.lifecycleDescription(selectedLifecycle);
  }

  protected lifecycleHelperText(item: AcquisitionSceneItem): string {
    switch (item.status.state) {
      case 'REQUESTED':
        return 'Waiting for Whisparr to pick up this request.';
      case 'DOWNLOADING':
        return 'Whisparr is actively pulling this scene right now.';
      case 'IMPORT_PENDING':
        return 'Whisparr has the file. Stash still needs to surface it in your library.';
      case 'FAILED':
        return 'This item stopped progressing and needs manual attention.';
      default:
        return '';
    }
  }

  protected operationalDetail(item: AcquisitionSceneItem): string | null {
    if (item.status.state === 'FAILED') {
      if (item.errorMessage?.trim()) {
        return `Whisparr reported: ${item.errorMessage.trim()}`;
      }

      if (item.queueStatus?.trim()) {
        return `Whisparr marked this item as ${this.humanizeStatus(item.queueStatus)}.`;
      }

      return 'Open Whisparr to inspect the failed queue item and retry or repair it there.';
    }

    if (item.status.state === 'IMPORT_PENDING') {
      if (item.queueState?.trim()) {
        return `Whisparr is in ${this.humanizeStatus(item.queueState)} while Stash catches up.`;
      }

      return 'If this lingers, check Stash and the indexing sync for the import handoff.';
    }

    if (item.status.state === 'DOWNLOADING') {
      if (item.queueStatus?.trim() && item.queueStatus.trim().toLowerCase() !== 'downloading') {
        return `Whisparr currently reports ${this.humanizeStatus(item.queueStatus)}.`;
      }

      return 'Use Whisparr when you need queue-level progress or worker details.';
    }

    if (item.status.state === 'REQUESTED' && item.queueStatus?.trim()) {
      return `Whisparr currently reports ${this.humanizeStatus(item.queueStatus)}.`;
    }

    return null;
  }

  protected emptyStateTitle(): string {
    switch (this.selectedLifecycle()) {
      case 'FAILED':
        return 'No failed scenes right now';
      case 'IMPORT_PENDING':
        return 'Nothing is waiting on import';
      case 'DOWNLOADING':
        return 'Nothing is downloading right now';
      case 'REQUESTED':
        return 'No queued requests are waiting to start';
      case 'ANY':
      default:
        return 'Nothing is moving through acquisition right now';
    }
  }

  protected emptyStateMessage(): string {
    switch (this.selectedLifecycle()) {
      case 'FAILED':
        return 'There is nothing to recover in Whisparr at the moment. Switch back to the full pipeline or request something new from Scenes.';
      case 'IMPORT_PENDING':
        return 'Downloads are not waiting on the final Stash handoff right now.';
      case 'DOWNLOADING':
        return 'Whisparr does not have any active acquisition work in progress right now.';
      case 'REQUESTED':
        return 'Whisparr is not holding any queued requests that have not started yet.';
      case 'ANY':
      default:
        return 'Requests begin in Scenes. Once Whisparr downloads and Stash imports them, they leave this page and continue in Library.';
    }
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  protected countLabel(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
  }

  protected sectionVisibleCountLabel(section: AcquisitionSectionView): string {
    if (section.totalCount === section.items.length) {
      return this.countLabel(section.totalCount, 'scene');
    }

    return `${this.countLabel(section.items.length, 'scene')} shown of ${section.totalCount}`;
  }

  private buildSection(
    lifecycle: AcquisitionLifecycleState,
    items: AcquisitionSceneItem[],
    totalCount: number,
  ): AcquisitionSectionView {
    return {
      lifecycle,
      label: this.filterLabel(lifecycle),
      description: this.lifecycleDescription(lifecycle),
      tone: this.lifecycleTone(lifecycle),
      totalCount,
      items,
    };
  }

  private filterLabel(lifecycle: AcquisitionLifecycleFilter): string {
    switch (lifecycle) {
      case 'REQUESTED':
        return 'Requested';
      case 'DOWNLOADING':
        return 'Downloading';
      case 'IMPORT_PENDING':
        return 'Awaiting Import';
      case 'FAILED':
        return 'Failed';
      case 'ANY':
      default:
        return 'All';
    }
  }

  private lifecycleDescription(lifecycle: AcquisitionLifecycleState): string {
    switch (lifecycle) {
      case 'FAILED':
        return 'These scenes are blocked. Open Whisparr, inspect the failure, and retry or repair the job there.';
      case 'IMPORT_PENDING':
        return 'Whisparr finished downloading these scenes, but they have not shown up in Stash yet.';
      case 'DOWNLOADING':
        return 'These scenes are actively working through the acquisition queue right now.';
      case 'REQUESTED':
      default:
        return 'These scenes are tracked in Whisparr but have not started downloading yet.';
    }
  }

  private lifecycleTone(lifecycle: AcquisitionLifecycleState): Exclude<AcquisitionSectionTone, 'overview'> {
    switch (lifecycle) {
      case 'FAILED':
        return 'attention';
      case 'IMPORT_PENDING':
        return 'pending';
      case 'DOWNLOADING':
        return 'active';
      case 'REQUESTED':
      default:
        return 'passive';
    }
  }

  private humanizeStatus(value: string): string {
    return value
      .trim()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private buildDegradedAlert(
    services: string[],
    source: 'setup' | 'runtime',
  ): AcquisitionPageAlert | null {
    const whisparrImpacted = services.includes('WHISPARR');
    const stashImpacted = services.includes('STASH');

    if (!whisparrImpacted && !stashImpacted) {
      return null;
    }

    if (whisparrImpacted && stashImpacted) {
      return {
        eyebrow: source === 'setup' ? 'Repair Required' : 'Runtime Outage',
        title: 'Acquisition tracking is degraded',
        message:
          'Whisparr and Stash are both affecting this page. Request progress, failure states, and import visibility may be incomplete or stale until both recover.',
      };
    }

    if (whisparrImpacted) {
      return {
        eyebrow: source === 'setup' ? 'Repair Required' : 'Runtime Outage',
        title: 'Whisparr needs attention',
        message:
          'Acquisition progress on this page depends on Whisparr. Queue state, failures, and request progression may be stale until it is healthy again.',
      };
    }

    return {
      eyebrow: source === 'setup' ? 'Repair Required' : 'Runtime Outage',
      title: 'Stash import visibility is degraded',
      message:
        'Downloaded scenes may take longer to appear as imported while Stash is unhealthy. Check Settings if import handoffs look stuck.',
    };
  }

  private loadRuntimeHealth(): void {
    this.runtimeHealthService
      .getStatus()
      .pipe(catchError(() => of(null)))
      .subscribe((status) => {
        this.runtimeHealth.set(status);
      });
  }

  private loadNextPage(): void {
    if (this.inFlight() || !this.hasMore()) {
      return;
    }

    const nextPage = this.page() + 1;
    const isInitialPage = nextPage === 1;
    const requestVersion = this.feedVersion;
    this.inFlight.set(true);

    if (isInitialPage) {
      this.loading.set(true);
      this.error.set(null);
    } else {
      this.loadingMore.set(true);
      this.loadMoreError.set(null);
    }

    this.acquisitionService
      .getScenesFeed(nextPage, AcquisitionPageComponent.PAGE_SIZE, this.selectedLifecycle())
      .pipe(
        finalize(() => {
          this.inFlight.set(false);

          if (requestVersion !== this.feedVersion) {
            if (this.pendingReload) {
              this.pendingReload = false;
              this.loadNextPage();
            }
            return;
          }

          if (isInitialPage) {
            this.loading.set(false);
          } else {
            this.loadingMore.set(false);
          }

          if (this.sentinelIntersecting && this.hasMore()) {
            this.loadNextPage();
          }
        }),
      )
      .subscribe({
        next: (response) => {
          if (requestVersion !== this.feedVersion) {
            return;
          }

          this.countsByLifecycle.set(response.countsByLifecycle);
          this.total.set(response.total);
          this.page.set(response.page);
          this.hasMore.set(response.hasMore);
          this.items.update((current) =>
            isInitialPage ? response.items : [...current, ...response.items],
          );
        },
        error: () => {
          if (requestVersion !== this.feedVersion) {
            return;
          }

          if (isInitialPage) {
            this.error.set('Failed to load acquisition feed from the API.');
          } else {
            this.loadMoreError.set('Failed to load more acquisition scenes.');
          }
        },
      });
  }

  private setupUrlStateSync(): void {
    this.queryParamSubscription = this.route.queryParamMap.subscribe((queryParamMap) => {
      const lifecycle = this.readUrlState(queryParamMap);
      const changed = this.applyUrlState(lifecycle);

      if (!this.hasHydratedFromUrl || changed) {
        this.hasHydratedFromUrl = true;
        this.resetFeedAndReload();
        return;
      }

      this.hasHydratedFromUrl = true;
    });
  }

  private readUrlState(queryParamMap: import('@angular/router').ParamMap): AcquisitionLifecycleFilter {
    const lifecycle = queryParamMap.get('lifecycle');

    return lifecycle === 'REQUESTED' ||
      lifecycle === 'DOWNLOADING' ||
      lifecycle === 'IMPORT_PENDING' ||
      lifecycle === 'FAILED'
      ? lifecycle
      : 'ANY';
  }

  private applyUrlState(state: AcquisitionLifecycleFilter): boolean {
    if (this.selectedLifecycle() === state) {
      return false;
    }

    this.selectedLifecycle.set(state);
    return true;
  }

  private syncUrlWithCurrentFilter(replaceUrl: boolean): void {
    const nextLifecycle = this.selectedLifecycle() === 'ANY' ? null : this.selectedLifecycle();
    const currentLifecycle = this.route.snapshot.queryParamMap.get('lifecycle');

    if ((currentLifecycle ?? null) === nextLifecycle) {
      return;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        lifecycle: nextLifecycle,
      },
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  private resetFeedAndReload(): void {
    this.feedVersion += 1;
    this.pendingReload = false;
    this.page.set(0);
    this.total.set(0);
    this.hasMore.set(true);
    this.items.set([]);
    this.loading.set(false);
    this.loadingMore.set(false);
    this.error.set(null);
    this.loadMoreError.set(null);

    if (this.inFlight()) {
      this.pendingReload = true;
      return;
    }

    this.loadNextPage();
  }

  private setupIntersectionObserver(): void {
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          const [entry] = entries;
          if (!entry) {
            return;
          }

          this.sentinelIntersecting = entry.isIntersecting;
          if (!entry.isIntersecting) {
            return;
          }

          if (this.inFlight() || !this.hasMore()) {
            return;
          }

          this.loadNextPage();
        },
        {
          root: null,
          rootMargin: '300px 0px',
          threshold: 0.01,
        },
      );
    }

    if (this.sentinelElement) {
      this.observer.observe(this.sentinelElement);
    }
  }
}
