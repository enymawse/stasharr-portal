import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, finalize } from 'rxjs';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { AcquisitionService } from '../../core/api/acquisition.service';
import {
  AcquisitionCountsByLifecycle,
  AcquisitionLifecycleFilter,
  AcquisitionSceneItem,
} from '../../core/api/acquisition.types';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

@Component({
  selector: 'app-acquisition-page',
  imports: [RouterLink, Message, ProgressSpinner, SceneStatusBadgeComponent],
  templateUrl: './acquisition-page.component.html',
  styleUrl: './acquisition-page.component.scss',
})
export class AcquisitionPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PAGE_SIZE = 50;
  private static readonly EMPTY_COUNTS: AcquisitionCountsByLifecycle = {
    REQUESTED: 0,
    DOWNLOADING: 0,
    IMPORT_PENDING: 0,
    FAILED: 0,
  };

  protected static readonly FILTER_OPTIONS: Array<{
    value: AcquisitionLifecycleFilter;
    label: string;
  }> = [
    { value: 'ANY', label: 'All' },
    { value: 'REQUESTED', label: 'Requested' },
    { value: 'DOWNLOADING', label: 'Downloading' },
    { value: 'IMPORT_PENDING', label: 'Awaiting Import' },
    { value: 'FAILED', label: 'Failed' },
  ];

  private readonly acquisitionService = inject(AcquisitionService);
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
  protected readonly selectedLifecycle = signal<AcquisitionLifecycleFilter>('ANY');
  protected readonly countsByLifecycle = signal<AcquisitionCountsByLifecycle>(
    AcquisitionPageComponent.EMPTY_COUNTS,
  );
  protected readonly filterOptions = AcquisitionPageComponent.FILTER_OPTIONS;

  ngOnInit(): void {
    this.setupUrlStateSync();
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

  protected activeSummaryText(): string {
    const activeCount = this.countForLifecycle('ANY');

    if (this.selectedLifecycle() === 'ANY') {
      return `${activeCount} scenes currently need acquisition tracking.`;
    }

    return `${this.total()} scenes match the ${this.filterLabel(
      this.selectedLifecycle(),
    ).toLowerCase()} filter.`;
  }

  protected filterLabel(lifecycle: AcquisitionLifecycleFilter): string {
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

  protected lifecycleHelperText(item: AcquisitionSceneItem): string {
    switch (item.status.state) {
      case 'REQUESTED':
        return 'Tracked in Whisparr and waiting for acquisition to begin.';
      case 'DOWNLOADING':
        return 'Acquisition is active in Whisparr right now.';
      case 'IMPORT_PENDING':
        return 'Whisparr has finished acquisition and Stash has not imported it yet.';
      case 'FAILED':
        return 'Resolve or retry this download in Whisparr.';
      default:
        return '';
    }
  }

  protected emptyStateMessage(): string {
    switch (this.selectedLifecycle()) {
      case 'REQUESTED':
        return 'No requested scenes are waiting to start right now.';
      case 'DOWNLOADING':
        return 'Nothing is downloading right now.';
      case 'IMPORT_PENDING':
        return 'Nothing is awaiting import right now.';
      case 'FAILED':
        return 'No failed scenes right now.';
      case 'ANY':
      default:
        return 'No active acquisition scenes are available right now.';
    }
  }

  protected currentRouteUrl(): string {
    return this.router.url;
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

  private readUrlState(
    queryParamMap: import('@angular/router').ParamMap,
  ): AcquisitionLifecycleFilter {
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
