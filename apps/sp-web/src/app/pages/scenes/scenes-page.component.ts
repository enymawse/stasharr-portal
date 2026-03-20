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
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { DiscoverItem, SceneRequestContext } from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

type SceneSortOption =
  | 'RELEASE_DATE'
  | 'TITLE'
  | 'TRENDING'
  | 'CREATED_AT'
  | 'UPDATED_AT';
type FavoritesFilterOption =
  | 'ALL_FAVORITES'
  | 'FAVORITE_PERFORMERS'
  | 'FAVORITE_STUDIOS';

@Component({
  selector: 'app-scenes-page',
  imports: [RouterLink, SceneStatusBadgeComponent, SceneRequestModalComponent],
  templateUrl: './scenes-page.component.html',
  styleUrl: './scenes-page.component.scss',
})
export class ScenesPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PAGE_SIZE = 50;
  protected static readonly SORT_OPTIONS: Array<{
    value: SceneSortOption;
    label: string;
  }> = [
    { value: 'RELEASE_DATE', label: 'Release Date' },
    { value: 'TITLE', label: 'Title' },
    { value: 'TRENDING', label: 'Trending' },
    { value: 'CREATED_AT', label: 'Created At' },
    { value: 'UPDATED_AT', label: 'Updated At' },
  ];
  protected static readonly FAVORITES_OPTIONS: Array<{
    value: FavoritesFilterOption;
    label: string;
  }> = [
    { value: 'ALL_FAVORITES', label: 'All Favorites' },
    { value: 'FAVORITE_PERFORMERS', label: 'Favorite Performers' },
    { value: 'FAVORITE_STUDIOS', label: 'Favorite Studios' },
  ];

  private readonly discoverService = inject(DiscoverService);
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
  protected readonly selectedSort = signal<SceneSortOption>('RELEASE_DATE');
  protected readonly selectedFavorites = signal<FavoritesFilterOption>(
    'ALL_FAVORITES',
  );
  protected readonly tagFilter = signal('');
  protected readonly sortOptions = ScenesPageComponent.SORT_OPTIONS;
  protected readonly favoritesOptions = ScenesPageComponent.FAVORITES_OPTIONS;

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

  protected onSortChanged(nextValue: string): void {
    if (
      nextValue === 'RELEASE_DATE' ||
      nextValue === 'TITLE' ||
      nextValue === 'TRENDING' ||
      nextValue === 'CREATED_AT' ||
      nextValue === 'UPDATED_AT'
    ) {
      this.selectedSort.set(nextValue);
    }
  }

  protected onFavoritesChanged(nextValue: string): void {
    if (
      nextValue === 'ALL_FAVORITES' ||
      nextValue === 'FAVORITE_PERFORMERS' ||
      nextValue === 'FAVORITE_STUDIOS'
    ) {
      this.selectedFavorites.set(nextValue);
    }
  }

  protected onTagFilterChanged(nextValue: string): void {
    this.tagFilter.set(nextValue);
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
              status: { state: 'DOWNLOADING' },
            }
          : item,
      ),
    );
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
      .getScenesFeed(nextPage, ScenesPageComponent.PAGE_SIZE)
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
            this.error.set('Failed to load scenes feed from the API.');
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
