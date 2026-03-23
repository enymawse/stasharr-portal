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
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  of,
  switchMap,
} from 'rxjs';
import { InputText } from 'primeng/inputtext';
import { Message } from 'primeng/message';
import { MultiSelect } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { DiscoverService } from '../../core/api/discover.service';
import {
  DiscoverItem,
  SceneFavoritesFilter,
  SceneFeedSort,
  SceneRequestContext,
  SceneTagMatchMode,
  SceneTagOption,
} from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

type FavoritesFilterOption = 'NONE' | SceneFavoritesFilter;
interface MultiSelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-scenes-page',
  imports: [
    RouterLink,
    FormsModule,
    Message,
    InputText,
    ProgressSpinner,
    Select,
    MultiSelect,
    SceneStatusBadgeComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './scenes-page.component.html',
  styleUrl: './scenes-page.component.scss',
})
export class ScenesPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PAGE_SIZE = 50;
  private static readonly DEFAULT_SORT: SceneFeedSort = 'DATE';
  private static readonly DEFAULT_FAVORITES: FavoritesFilterOption = 'NONE';
  private static readonly DEFAULT_TAG_MODE: SceneTagMatchMode = 'OR';
  protected static readonly SORT_OPTIONS: Array<{
    value: SceneFeedSort;
    label: string;
  }> = [
    { value: 'DATE', label: 'Release Date' },
    { value: 'TITLE', label: 'Title' },
    { value: 'TRENDING', label: 'Trending' },
    { value: 'CREATED_AT', label: 'Created At' },
    { value: 'UPDATED_AT', label: 'Updated At' },
  ];
  protected static readonly FAVORITES_OPTIONS: Array<{
    value: FavoritesFilterOption;
    label: string;
  }> = [
    { value: 'NONE', label: 'Any Scene' },
    { value: 'ALL', label: 'All Favorites' },
    { value: 'PERFORMER', label: 'Favorite Performers' },
    { value: 'STUDIO', label: 'Favorite Studios' },
  ];
  protected static readonly TAG_MATCH_OPTIONS: Array<{
    value: SceneTagMatchMode;
    label: string;
  }> = [
    { value: 'OR', label: 'OR (Any)' },
    { value: 'AND', label: 'AND (All)' },
  ];

  private readonly discoverService = inject(DiscoverService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly tagSearchTerms = new Subject<string>();
  private tagSearchSubscription: Subscription | null = null;
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
  protected readonly items = signal<DiscoverItem[]>([]);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);
  protected readonly selectedSort = signal<SceneFeedSort>(ScenesPageComponent.DEFAULT_SORT);
  protected readonly selectedFavorites = signal<FavoritesFilterOption>(
    ScenesPageComponent.DEFAULT_FAVORITES,
  );
  protected readonly tagSearchTerm = signal('');
  protected readonly selectedTagMode = signal<SceneTagMatchMode>(
    ScenesPageComponent.DEFAULT_TAG_MODE,
  );
  protected readonly selectedTags = signal<SceneTagOption[]>([]);
  protected readonly selectedTagIdsModel = signal<string[]>([]);
  protected readonly tagOptions = signal<SceneTagOption[]>([]);
  protected readonly tagSelectOptions = signal<MultiSelectOption[]>([]);
  protected readonly tagSearchLoading = signal(false);
  protected readonly tagSearchError = signal<string | null>(null);
  protected readonly sortOptions = ScenesPageComponent.SORT_OPTIONS;
  protected readonly favoritesOptions = ScenesPageComponent.FAVORITES_OPTIONS;
  protected readonly tagMatchOptions = ScenesPageComponent.TAG_MATCH_OPTIONS;

  ngOnInit(): void {
    this.setupTagSearch();
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
    this.tagSearchSubscription?.unsubscribe();
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
      nextValue === 'DATE' ||
      nextValue === 'TITLE' ||
      nextValue === 'TRENDING' ||
      nextValue === 'CREATED_AT' ||
      nextValue === 'UPDATED_AT'
    ) {
      if (this.selectedSort() === nextValue) {
        return;
      }

      this.selectedSort.set(nextValue);
      this.syncUrlWithCurrentFilters(false);
      this.resetFeedAndReload();
    }
  }

  protected onFavoritesChanged(nextValue: string): void {
    if (
      nextValue === 'NONE' ||
      nextValue === 'ALL' ||
      nextValue === 'PERFORMER' ||
      nextValue === 'STUDIO'
    ) {
      if (this.selectedFavorites() === nextValue) {
        return;
      }

      this.selectedFavorites.set(nextValue);
      this.syncUrlWithCurrentFilters(false);
      this.resetFeedAndReload();
    }
  }

  protected onTagSearchChanged(nextValue: string): void {
    this.tagSearchTerm.set(nextValue);
    this.tagSearchTerms.next(nextValue);
  }

  protected onTagSelectionChanged(nextValue: string[] | null): void {
    const nextIds = this.dedupeStrings(nextValue ?? []);
    this.selectedTagIdsModel.set(nextIds);

    const previousTags = new Map(this.selectedTags().map((tag) => [tag.id, tag]));
    const currentTags = new Map(this.tagOptions().map((tag) => [tag.id, tag]));
    const nextSelected = nextIds
      .map((id) => currentTags.get(id) ?? previousTags.get(id))
      .filter((tag): tag is SceneTagOption => Boolean(tag));
    const current = this.selectedTags();
    const changed =
      nextSelected.length !== current.length ||
      nextSelected.some((tag) => !this.isTagSelected(tag.id));

    this.selectedTags.set(nextSelected);
    this.rebuildTagSelectOptions(this.tagOptions());
    this.syncUrlWithCurrentFilters(false);

    if (!changed) {
      return;
    }

    this.resetFeedAndReload();
  }

  protected onTagMatchModeChanged(nextValue: string): void {
    if (nextValue !== 'OR' && nextValue !== 'AND') {
      return;
    }
    if (this.selectedTagMode() === nextValue) {
      return;
    }

    this.selectedTagMode.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    if (this.selectedTags().length > 0) {
      this.resetFeedAndReload();
    }
  }

  protected isTagSelected(tagId: string): boolean {
    return this.selectedTags().some((tag) => tag.id === tagId);
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

    this.discoverService
      .getScenesFeed(
        nextPage,
        ScenesPageComponent.PAGE_SIZE,
        this.selectedSort(),
        this.selectedTagIds(),
        this.selectedTagMode(),
        this.selectedFavoritesFilter(),
      )
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
            this.error.set('Failed to load scenes feed from the API.');
          } else {
            this.loadMoreError.set('Failed to load more scenes.');
          }
        },
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

  private selectedTagIds(): string[] {
    return this.selectedTags().map((tag) => tag.id);
  }

  private selectedFavoritesFilter(): SceneFavoritesFilter | undefined {
    const selectedFavorites = this.selectedFavorites();
    return selectedFavorites === 'NONE' ? undefined : selectedFavorites;
  }

  private setupUrlStateSync(): void {
    this.queryParamSubscription = this.route.queryParamMap.subscribe((queryParamMap) => {
      const urlState = this.readUrlState(queryParamMap);
      const changed = this.applyUrlState(urlState);
      if (!this.hasHydratedFromUrl || changed) {
        this.hasHydratedFromUrl = true;
        this.resetFeedAndReload();
        return;
      }

      this.hasHydratedFromUrl = true;
    });
  }

  private readUrlState(queryParamMap: import('@angular/router').ParamMap): {
    sort: SceneFeedSort;
    favorites: FavoritesFilterOption;
    mode: SceneTagMatchMode;
    tagIds: string[];
    tagNamesById: Map<string, string>;
  } {
    const sortParam = queryParamMap.get('sort');
    const sort: SceneFeedSort =
      sortParam === 'DATE' ||
      sortParam === 'TITLE' ||
      sortParam === 'TRENDING' ||
      sortParam === 'CREATED_AT' ||
      sortParam === 'UPDATED_AT'
        ? sortParam
        : ScenesPageComponent.DEFAULT_SORT;

    const favoritesParam = queryParamMap.get('fav');
    const favorites: FavoritesFilterOption =
      favoritesParam === 'NONE' ||
      favoritesParam === 'ALL' ||
      favoritesParam === 'PERFORMER' ||
      favoritesParam === 'STUDIO'
        ? favoritesParam
        : ScenesPageComponent.DEFAULT_FAVORITES;

    const modeParam = queryParamMap.get('mode');
    const mode: SceneTagMatchMode =
      modeParam === 'OR' || modeParam === 'AND'
        ? modeParam
        : ScenesPageComponent.DEFAULT_TAG_MODE;

    const rawTagIds = (queryParamMap.get('tags') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const rawTagNames = (queryParamMap.get('tagNames') ?? '')
      .split(',')
      .map((value) => value.trim());

    const tagNamesById = new Map<string, string>();
    rawTagIds.forEach((id, index) => {
      const name = rawTagNames[index];
      if (name) {
        tagNamesById.set(id, name);
      }
    });

    const tagIds = this.dedupeStrings(rawTagIds);

    return {
      sort,
      favorites,
      mode,
      tagIds,
      tagNamesById,
    };
  }

  private applyUrlState(state: {
    sort: SceneFeedSort;
    favorites: FavoritesFilterOption;
    mode: SceneTagMatchMode;
    tagIds: string[];
    tagNamesById: Map<string, string>;
  }): boolean {
    const currentSelectedIds = this.selectedTagIds();
    const tagsChanged = !this.areStringArraysEqual(currentSelectedIds, state.tagIds);
    const changed =
      this.selectedSort() !== state.sort ||
      this.selectedFavorites() !== state.favorites ||
      this.selectedTagMode() !== state.mode ||
      tagsChanged;

    if (!changed) {
      return false;
    }

    this.selectedSort.set(state.sort);
    this.selectedFavorites.set(state.favorites);
    this.selectedTagMode.set(state.mode);
    this.selectedTagIdsModel.set(state.tagIds);

    if (tagsChanged) {
      const previousTags = new Map(this.selectedTags().map((tag) => [tag.id, tag]));
      const nextSelectedTags = state.tagIds.map((id) => {
        const existing = previousTags.get(id);
        if (existing) {
          return existing;
        }

        return {
          id,
          name: state.tagNamesById.get(id) ?? id,
          description: null,
          aliases: [],
        } satisfies SceneTagOption;
      });
      this.selectedTags.set(nextSelectedTags);
    }

    this.rebuildTagSelectOptions(this.tagOptions());
    return true;
  }

  private syncUrlWithCurrentFilters(replaceUrl: boolean): void {
    const next = {
      sort:
        this.selectedSort() === ScenesPageComponent.DEFAULT_SORT
          ? null
          : this.selectedSort(),
      fav:
        this.selectedFavorites() === ScenesPageComponent.DEFAULT_FAVORITES
          ? null
          : this.selectedFavorites(),
      mode:
        this.selectedTagMode() === ScenesPageComponent.DEFAULT_TAG_MODE
          ? null
          : this.selectedTagMode(),
      tags: this.selectedTagIds().length > 0 ? this.selectedTagIds().join(',') : null,
      tagNames:
        this.selectedTags().length > 0
          ? this.selectedTags()
              .map((tag) => tag.name.trim())
              .join(',')
          : null,
    };

    const current = this.route.snapshot.queryParamMap;
    const currentSort = current.get('sort');
    const currentFav = current.get('fav');
    const currentMode = current.get('mode');
    const currentTags = current.get('tags');
    const currentTagNames = current.get('tagNames');
    if (
      (currentSort ?? null) === next.sort &&
      (currentFav ?? null) === next.fav &&
      (currentMode ?? null) === next.mode &&
      (currentTags ?? null) === next.tags &&
      (currentTagNames ?? null) === next.tagNames
    ) {
      return;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: next,
      queryParamsHandling: 'merge',
      replaceUrl,
    });
  }

  private setupTagSearch(): void {
    this.tagSearchSubscription = this.tagSearchTerms
      .pipe(
        map((value) => value.trim()),
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query) {
            this.tagOptions.set([]);
            this.tagSelectOptions.set(this.selectedTagsToSelectOptions());
            this.tagSearchError.set(null);
            return of<SceneTagOption[]>([]);
          }

          this.tagSearchLoading.set(true);
          this.tagSearchError.set(null);

          return this.discoverService.searchSceneTags(query).pipe(
            catchError(() => {
              this.tagSearchError.set('Failed to load tag options.');
              return of<SceneTagOption[]>([]);
            }),
            finalize(() => {
              this.tagSearchLoading.set(false);
            }),
          );
        }),
      )
      .subscribe((options) => {
        this.tagOptions.set(options);
        this.rebuildTagSelectOptions(options);
      });
  }

  private selectedTagsToSelectOptions(): MultiSelectOption[] {
    return this.selectedTags().map((tag) => ({
      label: tag.name,
      value: tag.id,
    }));
  }

  private rebuildTagSelectOptions(searchResults: SceneTagOption[]): void {
    const merged = new Map<string, MultiSelectOption>();

    for (const selected of this.selectedTags()) {
      merged.set(selected.id, {
        label: selected.name,
        value: selected.id,
      });
    }

    for (const tag of searchResults) {
      merged.set(tag.id, {
        label: tag.name,
        value: tag.id,
      });
    }

    this.tagSelectOptions.set([...merged.values()]);
  }

  private dedupeStrings(values: string[]): string[] {
    const deduped = new Set<string>();
    for (const value of values) {
      deduped.add(value);
    }
    return [...deduped];
  }

  private areStringArraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) {
        return false;
      }
    }

    return true;
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
