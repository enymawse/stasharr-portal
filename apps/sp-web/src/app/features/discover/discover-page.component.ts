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
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { DiscoverService } from '../../core/api/discover.service';
import { DiscoverItem, SceneRequestContext } from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

@Component({
  selector: 'app-discover-page',
  imports: [
    RouterLink,
    Message,
    ProgressSpinner,
    SceneStatusBadgeComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './discover-page.component.html',
  styleUrl: './discover-page.component.scss',
})
export class DiscoverPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PAGE_SIZE = 50;

  private readonly discoverService = inject(DiscoverService);
  private readonly router = inject(Router);
  private observer: IntersectionObserver | null = null;
  private sentinelElement: HTMLDivElement | null = null;
  private sentinelIntersecting = false;

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
  protected readonly items = signal<DiscoverItem[]>([]);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);

  ngOnInit(): void {
    this.loadNextPage();
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    if (this.observer && this.sentinelElement) {
      this.observer.unobserve(this.sentinelElement);
    }
    this.observer?.disconnect();
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

  protected isRequestable(item: DiscoverItem): boolean {
    return item.status.state === 'NOT_REQUESTED';
  }

  protected openRequestModal(item: DiscoverItem): void {
    if (!this.isRequestable(item)) {
      return;
    }

    this.requestContext.set({
      id: item.id,
      title: item.title,
      imageUrl: item.imageUrl,
    });
    this.requestModalOpen.set(true);
  }

  protected onRequestModalClosed(): void {
    this.requestModalOpen.set(false);
  }

  protected onRequestSubmitted(stashId: string): void {
    this.items.update((current) =>
      current.map((item) =>
        item.id === stashId
          ? {
              ...item,
              status: { state: 'REQUESTED' },
            }
          : item,
      ),
    );
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  protected studioBadgeQueryParams(item: DiscoverItem): Record<string, string> | null {
    if (!item.studioId || !item.studio) {
      return null;
    }

    return {
      studios: item.studioId,
      studioNames: item.studio,
    };
  }

  private loadNextPage(): void {
    if (this.inFlight() || !this.hasMore()) {
      return;
    }

    const nextPage = this.page() + 1;
    const isInitialPage = nextPage === 1;
    this.inFlight.set(true);

    if (isInitialPage) {
      this.loading.set(true);
      this.error.set(null);
    } else {
      this.loadingMore.set(true);
      this.loadMoreError.set(null);
    }

    this.discoverService
      .getDiscoverFeed(nextPage, DiscoverPageComponent.PAGE_SIZE)
      .pipe(
        finalize(() => {
          this.inFlight.set(false);
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
          this.total.set(response.total);
          this.page.set(response.page);
          this.hasMore.set(response.hasMore);
          this.items.update((current) =>
            isInitialPage ? response.items : [...current, ...response.items],
          );
        },
        error: () => {
          if (isInitialPage) {
            this.error.set('Failed to load discover feed from the API.');
          } else {
            this.loadMoreError.set('Failed to load more scenes.');
          }
        },
      });
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
