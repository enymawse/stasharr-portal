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
import {
  Subject,
  Subscription,
  debounceTime,
  distinctUntilChanged,
  finalize,
} from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import {
  PerformerFeedItem,
  PerformerGender,
  PerformerSort,
} from '../../core/api/discover.types';

type GenderOption = PerformerGender | 'NONE';

@Component({
  selector: 'app-performers-page',
  imports: [RouterLink],
  templateUrl: './performers-page.component.html',
  styleUrl: './performers-page.component.scss',
})
export class PerformersPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PAGE_SIZE = 50;
  private static readonly NAME_FILTER_DEBOUNCE_MS = 300;

  protected static readonly SORT_OPTIONS: Array<{
    value: PerformerSort;
    label: string;
  }> = [
    { value: 'NAME', label: 'Name' },
    { value: 'BIRTHDATE', label: 'Birthdate' },
    { value: 'SCENE_COUNT', label: 'Scene Count' },
    { value: 'CAREER_START_YEAR', label: 'Career Start Year' },
    { value: 'DEBUT', label: 'Debut' },
    { value: 'LAST_SCENE', label: 'Last Scene' },
    { value: 'CREATED_AT', label: 'Created At' },
    { value: 'UPDATED_AT', label: 'Updated At' },
  ];

  protected static readonly GENDER_OPTIONS: Array<{
    value: GenderOption;
    label: string;
  }> = [
    { value: 'NONE', label: 'Any Gender' },
    { value: 'FEMALE', label: 'Female' },
    { value: 'MALE', label: 'Male' },
    { value: 'NON_BINARY', label: 'Non-Binary' },
    { value: 'TRANSGENDER_FEMALE', label: 'Transgender Female' },
    { value: 'TRANSGENDER_MALE', label: 'Transgender Male' },
    { value: 'INTERSEX', label: 'Intersex' },
    { value: 'UNKNOWN', label: 'Unknown' },
  ];

  private readonly discoverService = inject(DiscoverService);
  private readonly nameFilterTerms = new Subject<string>();
  private nameFilterSubscription: Subscription | null = null;
  private observer: IntersectionObserver | null = null;
  private sentinelElement: HTMLDivElement | null = null;
  private sentinelIntersecting = false;
  private feedVersion = 0;
  private pendingReload = false;

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
  protected readonly items = signal<PerformerFeedItem[]>([]);
  protected readonly nameFilter = signal('');
  protected readonly selectedGender = signal<GenderOption>('NONE');
  protected readonly selectedSort = signal<PerformerSort>('NAME');
  protected readonly favoritesOnly = signal(false);
  protected readonly sortOptions = PerformersPageComponent.SORT_OPTIONS;
  protected readonly genderOptions = PerformersPageComponent.GENDER_OPTIONS;

  ngOnInit(): void {
    this.setupNameFilterDebounce();
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
    this.nameFilterSubscription?.unsubscribe();
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

  protected onNameFilterChanged(nextValue: string): void {
    this.nameFilter.set(nextValue);
    this.nameFilterTerms.next(nextValue);
  }

  protected onGenderChanged(nextValue: string): void {
    if (
      nextValue === 'NONE' ||
      nextValue === 'MALE' ||
      nextValue === 'FEMALE' ||
      nextValue === 'UNKNOWN' ||
      nextValue === 'TRANSGENDER_MALE' ||
      nextValue === 'TRANSGENDER_FEMALE' ||
      nextValue === 'INTERSEX' ||
      nextValue === 'NON_BINARY'
    ) {
      if (this.selectedGender() === nextValue) {
        return;
      }

      this.selectedGender.set(nextValue);
      this.resetFeedAndReload();
    }
  }

  protected onSortChanged(nextValue: string): void {
    if (
      nextValue === 'NAME' ||
      nextValue === 'BIRTHDATE' ||
      nextValue === 'SCENE_COUNT' ||
      nextValue === 'CAREER_START_YEAR' ||
      nextValue === 'DEBUT' ||
      nextValue === 'LAST_SCENE' ||
      nextValue === 'CREATED_AT' ||
      nextValue === 'UPDATED_AT'
    ) {
      if (this.selectedSort() === nextValue) {
        return;
      }

      this.selectedSort.set(nextValue);
      this.resetFeedAndReload();
    }
  }

  protected onFavoritesOnlyChanged(nextValue: boolean): void {
    if (this.favoritesOnly() === nextValue) {
      return;
    }

    this.favoritesOnly.set(nextValue);
    this.resetFeedAndReload();
  }

  protected performerInitial(name: string): string {
    return name.trim().charAt(0).toUpperCase();
  }

  protected formattedGender(gender: PerformerGender | null): string | null {
    if (!gender) {
      return null;
    }

    return gender
      .split('_')
      .map((token) => token.charAt(0) + token.slice(1).toLowerCase())
      .join(' ');
  }

  protected favoriteIndicatorLabel(isFavorite: boolean): string {
    return isFavorite ? 'Favorite performer' : 'Not marked favorite';
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

    this.discoverService
      .getPerformersFeed(nextPage, PerformersPageComponent.PAGE_SIZE, {
        name: this.normalizedNameFilter(),
        gender: this.selectedGenderFilter(),
        sort: this.selectedSort(),
        favoritesOnly: this.favoritesOnly(),
      })
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
            this.error.set('Failed to load performers feed from the API.');
          } else {
            this.loadMoreError.set('Failed to load more performers.');
          }
        },
      });
  }

  private normalizedNameFilter(): string | undefined {
    const normalizedName = this.nameFilter().trim();
    return normalizedName.length > 0 ? normalizedName : undefined;
  }

  private selectedGenderFilter(): PerformerGender | undefined {
    const gender = this.selectedGender();
    return gender === 'NONE' ? undefined : gender;
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

  private setupNameFilterDebounce(): void {
    this.nameFilterSubscription = this.nameFilterTerms
      .pipe(
        debounceTime(PerformersPageComponent.NAME_FILTER_DEBOUNCE_MS),
        distinctUntilChanged(),
      )
      .subscribe(() => {
        this.resetFeedAndReload();
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
