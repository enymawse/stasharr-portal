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
import { Message } from 'primeng/message';
import { MultiSelect } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { DiscoverService } from '../../core/api/discover.service';
import {
  PerformerStudioOption,
  SceneFavoritesFilter,
  SceneFeedSort,
  SceneExplorerItem,
  SceneLibraryAvailability,
  SceneRequestContext,
  SortDirection,
  SceneTagMatchMode,
  SceneTagOption,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

type FavoritesFilterOption = 'NONE' | SceneFavoritesFilter;
interface MultiSelectOption {
  label: string;
  value: string;
}

interface MultiSelectGroup {
  label: string;
  items: MultiSelectOption[];
}

interface SelectedStudioChip {
  id: string;
  label: string;
}

@Component({
  selector: 'app-scenes-page',
  imports: [
    RouterLink,
    FormsModule,
    Message,
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
  private static readonly SEARCH_DEBOUNCE_MS = 250;
  private static readonly DEFAULT_SORT: SceneFeedSort = 'DATE';
  private static readonly DEFAULT_DIRECTION: SortDirection = 'DESC';
  private static readonly DEFAULT_FAVORITES: FavoritesFilterOption = 'NONE';
  private static readonly DEFAULT_TAG_MODE: SceneTagMatchMode = 'OR';
  private static readonly DEFAULT_LIBRARY_AVAILABILITY: SceneLibraryAvailability = 'ANY';
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
  protected static readonly LIBRARY_AVAILABILITY_OPTIONS: Array<{
    value: SceneLibraryAvailability;
    label: string;
  }> = [
    { value: 'ANY', label: 'Any Scene' },
    { value: 'IN_LIBRARY', label: 'Already In Library' },
    { value: 'MISSING_FROM_LIBRARY', label: 'Missing From Library' },
  ];

  private readonly discoverService = inject(DiscoverService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly studioSearchTerms = new Subject<string>();
  private readonly tagSearchTerms = new Subject<string>();
  private studioSearchSubscription: Subscription | null = null;
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
  protected readonly total = signal<number | null>(0);
  protected readonly page = signal(0);
  protected readonly hasMore = signal(true);
  protected readonly inFlight = signal(false);
  protected readonly items = signal<SceneExplorerItem[]>([]);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);
  protected readonly selectedSort = signal<SceneFeedSort>(ScenesPageComponent.DEFAULT_SORT);
  protected readonly selectedDirection = signal<SortDirection>(
    ScenesPageComponent.DEFAULT_DIRECTION,
  );
  protected readonly selectedFavorites = signal<FavoritesFilterOption>(
    ScenesPageComponent.DEFAULT_FAVORITES,
  );
  protected readonly selectedLibraryAvailability = signal<SceneLibraryAvailability>(
    ScenesPageComponent.DEFAULT_LIBRARY_AVAILABILITY,
  );
  protected readonly stashFavoritePerformersOnly = signal(false);
  protected readonly stashFavoriteStudiosOnly = signal(false);
  protected readonly stashFavoriteTagsOnly = signal(false);
  protected readonly tagSearchTerm = signal('');
  protected readonly selectedTagMode = signal<SceneTagMatchMode>(
    ScenesPageComponent.DEFAULT_TAG_MODE,
  );
  protected readonly selectedTags = signal<SceneTagOption[]>([]);
  protected readonly selectedTagIdsModel = signal<string[]>([]);
  protected readonly tagOptions = signal<SceneTagOption[]>([]);
  protected readonly tagSelectOptions = signal<MultiSelectOption[]>([]);
  protected readonly studioSearchTerm = signal('');
  protected readonly selectedStudios = signal<SelectedStudioChip[]>([]);
  protected readonly studioSelectedIdsModel = signal<string[]>([]);
  protected readonly studioOptions = signal<PerformerStudioOption[]>([]);
  protected readonly studioSelectOptions = signal<MultiSelectGroup[]>([]);
  protected readonly studioSearchLoading = signal(false);
  protected readonly studioSearchError = signal<string | null>(null);
  protected readonly tagSearchLoading = signal(false);
  protected readonly tagSearchError = signal<string | null>(null);
  protected readonly sortOptions = ScenesPageComponent.SORT_OPTIONS;
  protected readonly favoritesOptions = ScenesPageComponent.FAVORITES_OPTIONS;
  protected readonly tagMatchOptions = ScenesPageComponent.TAG_MATCH_OPTIONS;
  protected readonly libraryAvailabilityOptions = ScenesPageComponent.LIBRARY_AVAILABILITY_OPTIONS;

  ngOnInit(): void {
    this.setupStudioSearch();
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
    this.studioSearchSubscription?.unsubscribe();
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

  protected isRequestable(item: SceneExplorerItem): boolean {
    return item.requestable && isSceneStatusRequestable(item.status);
  }

  protected openRequestModal(item: SceneExplorerItem): void {
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

  protected onDirectionChanged(nextValue: string): void {
    if (nextValue !== 'ASC' && nextValue !== 'DESC') {
      return;
    }

    if (this.selectedDirection() === nextValue) {
      return;
    }

    this.selectedDirection.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected toggleSortDirection(): void {
    this.onDirectionChanged(this.selectedDirection() === 'ASC' ? 'DESC' : 'ASC');
  }

  protected sortDirectionIconClass(): string {
    return this.selectedDirection() === 'ASC'
      ? 'pi pi-sort-amount-up-alt'
      : 'pi pi-sort-amount-down-alt';
  }

  protected sortDirectionToggleLabel(): string {
    return this.selectedDirection() === 'ASC'
      ? 'Sort direction: ascending. Toggle to descending.'
      : 'Sort direction: descending. Toggle to ascending.';
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

  protected onLibraryAvailabilityChanged(nextValue: string): void {
    if (nextValue !== 'ANY' && nextValue !== 'IN_LIBRARY' && nextValue !== 'MISSING_FROM_LIBRARY') {
      return;
    }

    if (this.selectedLibraryAvailability() === nextValue) {
      return;
    }

    this.selectedLibraryAvailability.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected onStashFavoritePerformersChanged(nextValue: boolean): void {
    if (this.stashFavoritePerformersOnly() === nextValue) {
      return;
    }

    this.stashFavoritePerformersOnly.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected onStashFavoriteStudiosChanged(nextValue: boolean): void {
    if (this.stashFavoriteStudiosOnly() === nextValue) {
      return;
    }

    this.stashFavoriteStudiosOnly.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected onStashFavoriteTagsChanged(nextValue: boolean): void {
    if (this.stashFavoriteTagsOnly() === nextValue) {
      return;
    }

    this.stashFavoriteTagsOnly.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected hasHybridFiltersActive(): boolean {
    return (
      this.selectedLibraryAvailability() !== ScenesPageComponent.DEFAULT_LIBRARY_AVAILABILITY ||
      this.stashFavoritePerformersOnly() ||
      this.stashFavoriteStudiosOnly() ||
      this.stashFavoriteTagsOnly()
    );
  }

  protected scenesTotalLabel(): string {
    const total = this.total();
    if (total === null) {
      return 'Showing lifecycle-aware results.';
    }

    return `Total scenes: ${total}`;
  }

  protected onTagFilterChanged(nextValue: string | null | undefined): void {
    const nextTerm = (nextValue ?? '').trimStart();
    this.tagSearchTerm.set(nextTerm);
    this.tagSearchTerms.next(nextTerm);
  }

  protected onStudioFilterChanged(nextValue: string | null | undefined): void {
    const nextTerm = (nextValue ?? '').trimStart();
    this.studioSearchTerm.set(nextTerm);
    this.studioSearchTerms.next(nextTerm);
  }

  protected onTagFilterPanelHide(): void {
    this.onTagFilterChanged('');
  }

  protected onStudioFilterPanelHide(): void {
    this.onStudioFilterChanged('');
  }

  protected studioSelectEmptyMessage(): string {
    if (this.studioSearchError()) {
      return this.studioSearchError() ?? 'Failed to load studio options.';
    }

    if (this.studioSearchTerm().trim().length === 0) {
      return 'Type to search studio networks.';
    }

    return 'No matching studios.';
  }

  protected tagSelectEmptyMessage(): string {
    if (this.tagSearchError()) {
      return this.tagSearchError() ?? 'Failed to load tag options.';
    }

    if (this.tagSearchTerm().trim().length === 0) {
      return 'Type to search tags.';
    }

    return 'No matching tags.';
  }

  protected onStudioSelectionChanged(nextValue: string[] | null): void {
    const nextIds = this.dedupeStrings(nextValue ?? []);
    this.studioSelectedIdsModel.set(nextIds);

    const changed = !this.areStringArraysEqual(this.selectedStudioIds(), nextIds);
    if (!changed) {
      return;
    }

    const previousLabels = new Map(
      this.selectedStudios().map((studio) => [studio.id, studio.label]),
    );
    const currentLabels = this.studioLabelMap();
    this.selectedStudios.set(
      nextIds.map((id) => ({
        id,
        label: currentLabels.get(id) ?? previousLabels.get(id) ?? id,
      })),
    );
    this.rebuildStudioSelectOptions(this.studioOptions());
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
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
              requestable: false,
              status: { state: 'REQUESTED' },
            }
          : item,
      ),
    );
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  protected studioBadgeQueryParams(item: SceneExplorerItem): Record<string, string> | null {
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
        this.selectedDirection(),
        this.selectedTagIds(),
        this.selectedTagMode(),
        this.selectedFavoritesFilter(),
        this.selectedStudioIds(),
        this.selectedLibraryAvailability(),
        this.stashFavoritePerformersOnly(),
        this.stashFavoriteStudiosOnly(),
        this.stashFavoriteTagsOnly(),
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

  private selectedStudioIds(): string[] {
    return this.selectedStudios().map((studio) => studio.id);
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
    direction: SortDirection;
    favorites: FavoritesFilterOption;
    availability: SceneLibraryAvailability;
    stashFavoritePerformersOnly: boolean;
    stashFavoriteStudiosOnly: boolean;
    stashFavoriteTagsOnly: boolean;
    mode: SceneTagMatchMode;
    tagIds: string[];
    tagNamesById: Map<string, string>;
    studioIds: string[];
    studioNamesById: Map<string, string>;
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
    const directionParam = queryParamMap.get('dir');
    const direction: SortDirection =
      directionParam === 'ASC' || directionParam === 'DESC'
        ? directionParam
        : ScenesPageComponent.DEFAULT_DIRECTION;
    const availabilityParam = queryParamMap.get('availability');
    const availability: SceneLibraryAvailability =
      availabilityParam === 'ANY' ||
      availabilityParam === 'IN_LIBRARY' ||
      availabilityParam === 'MISSING_FROM_LIBRARY'
        ? availabilityParam
        : ScenesPageComponent.DEFAULT_LIBRARY_AVAILABILITY;
    const stashFavoritePerformersOnly = queryParamMap.get('stashFavPerformers') === '1';
    const stashFavoriteStudiosOnly = queryParamMap.get('stashFavStudios') === '1';
    const stashFavoriteTagsOnly = queryParamMap.get('stashFavTags') === '1';

    const modeParam = queryParamMap.get('mode');
    const mode: SceneTagMatchMode =
      modeParam === 'OR' || modeParam === 'AND' ? modeParam : ScenesPageComponent.DEFAULT_TAG_MODE;

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
    const rawStudioIds = (queryParamMap.get('studios') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const rawStudioNames = (queryParamMap.get('studioNames') ?? '')
      .split(',')
      .map((value) => value.trim());
    const studioNamesById = new Map<string, string>();
    rawStudioIds.forEach((id, index) => {
      const name = rawStudioNames[index];
      if (name) {
        studioNamesById.set(id, name);
      }
    });
    const studioIds = this.dedupeStrings(rawStudioIds);

    return {
      sort,
      direction,
      favorites,
      availability,
      stashFavoritePerformersOnly,
      stashFavoriteStudiosOnly,
      stashFavoriteTagsOnly,
      mode,
      tagIds,
      tagNamesById,
      studioIds,
      studioNamesById,
    };
  }

  private applyUrlState(state: {
    sort: SceneFeedSort;
    direction: SortDirection;
    favorites: FavoritesFilterOption;
    availability: SceneLibraryAvailability;
    stashFavoritePerformersOnly: boolean;
    stashFavoriteStudiosOnly: boolean;
    stashFavoriteTagsOnly: boolean;
    mode: SceneTagMatchMode;
    tagIds: string[];
    tagNamesById: Map<string, string>;
    studioIds: string[];
    studioNamesById: Map<string, string>;
  }): boolean {
    const currentSelectedIds = this.selectedTagIds();
    const currentSelectedStudioIds = this.selectedStudioIds();
    const tagsChanged = !this.areStringArraysEqual(currentSelectedIds, state.tagIds);
    const studiosChanged = !this.areStringArraysEqual(currentSelectedStudioIds, state.studioIds);
    const changed =
      this.selectedSort() !== state.sort ||
      this.selectedDirection() !== state.direction ||
      this.selectedFavorites() !== state.favorites ||
      this.selectedLibraryAvailability() !== state.availability ||
      this.stashFavoritePerformersOnly() !== state.stashFavoritePerformersOnly ||
      this.stashFavoriteStudiosOnly() !== state.stashFavoriteStudiosOnly ||
      this.stashFavoriteTagsOnly() !== state.stashFavoriteTagsOnly ||
      this.selectedTagMode() !== state.mode ||
      tagsChanged ||
      studiosChanged;

    if (!changed) {
      return false;
    }

    this.selectedSort.set(state.sort);
    this.selectedDirection.set(state.direction);
    this.selectedFavorites.set(state.favorites);
    this.selectedLibraryAvailability.set(state.availability);
    this.stashFavoritePerformersOnly.set(state.stashFavoritePerformersOnly);
    this.stashFavoriteStudiosOnly.set(state.stashFavoriteStudiosOnly);
    this.stashFavoriteTagsOnly.set(state.stashFavoriteTagsOnly);
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

    if (studiosChanged) {
      const previousStudios = new Map(
        this.selectedStudios().map((studio) => [studio.id, studio.label]),
      );
      this.selectedStudios.set(
        state.studioIds.map((id) => ({
          id,
          label: state.studioNamesById.get(id) ?? previousStudios.get(id) ?? id,
        })),
      );
      this.studioSelectedIdsModel.set(state.studioIds);
    }

    this.rebuildTagSelectOptions(this.tagOptions());
    this.rebuildStudioSelectOptions(this.studioOptions());
    return true;
  }

  private syncUrlWithCurrentFilters(replaceUrl: boolean): void {
    const next = {
      sort: this.selectedSort() === ScenesPageComponent.DEFAULT_SORT ? null : this.selectedSort(),
      dir:
        this.selectedDirection() === ScenesPageComponent.DEFAULT_DIRECTION
          ? null
          : this.selectedDirection(),
      fav:
        this.selectedFavorites() === ScenesPageComponent.DEFAULT_FAVORITES
          ? null
          : this.selectedFavorites(),
      availability:
        this.selectedLibraryAvailability() === ScenesPageComponent.DEFAULT_LIBRARY_AVAILABILITY
          ? null
          : this.selectedLibraryAvailability(),
      stashFavPerformers: this.stashFavoritePerformersOnly() ? '1' : null,
      stashFavStudios: this.stashFavoriteStudiosOnly() ? '1' : null,
      stashFavTags: this.stashFavoriteTagsOnly() ? '1' : null,
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
      studios: this.selectedStudioIds().length > 0 ? this.selectedStudioIds().join(',') : null,
      studioNames:
        this.selectedStudios().length > 0
          ? this.selectedStudios()
              .map((studio) => studio.label.trim())
              .join(',')
          : null,
    };

    const current = this.route.snapshot.queryParamMap;
    const currentSort = current.get('sort');
    const currentFav = current.get('fav');
    const currentDir = current.get('dir');
    const currentMode = current.get('mode');
    const currentAvailability = current.get('availability');
    const currentStashFavPerformers = current.get('stashFavPerformers');
    const currentStashFavStudios = current.get('stashFavStudios');
    const currentStashFavTags = current.get('stashFavTags');
    const currentTags = current.get('tags');
    const currentTagNames = current.get('tagNames');
    const currentStudios = current.get('studios');
    const currentStudioNames = current.get('studioNames');
    if (
      (currentSort ?? null) === next.sort &&
      (currentDir ?? null) === next.dir &&
      (currentFav ?? null) === next.fav &&
      (currentAvailability ?? null) === next.availability &&
      (currentStashFavPerformers ?? null) === next.stashFavPerformers &&
      (currentStashFavStudios ?? null) === next.stashFavStudios &&
      (currentStashFavTags ?? null) === next.stashFavTags &&
      (currentMode ?? null) === next.mode &&
      (currentTags ?? null) === next.tags &&
      (currentTagNames ?? null) === next.tagNames &&
      (currentStudios ?? null) === next.studios &&
      (currentStudioNames ?? null) === next.studioNames
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

  private setupStudioSearch(): void {
    this.studioSearchSubscription = this.studioSearchTerms
      .pipe(
        map((value) => value.trim()),
        debounceTime(ScenesPageComponent.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query) {
            this.studioOptions.set([]);
            this.rebuildStudioSelectOptions([]);
            this.studioSearchError.set(null);
            return of<PerformerStudioOption[]>([]);
          }

          this.studioSearchLoading.set(true);
          this.studioSearchError.set(null);

          return this.discoverService.searchPerformerStudios(query).pipe(
            catchError(() => {
              this.studioSearchError.set('Failed to load studio options.');
              return of<PerformerStudioOption[]>([]);
            }),
            finalize(() => {
              this.studioSearchLoading.set(false);
            }),
          );
        }),
      )
      .subscribe((options) => {
        this.studioOptions.set(options);
        this.rebuildStudioSelectOptions(options);
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

  private rebuildStudioSelectOptions(options: PerformerStudioOption[]): void {
    const selectedLabels = new Map(
      this.selectedStudios().map((studio) => [studio.id, studio.label]),
    );
    const grouped = options.map((network) => {
      const groupItems: MultiSelectOption[] = [
        {
          label: `${network.name} (Network)`,
          value: network.id,
        },
        ...network.childStudios.map((child) => ({
          label: child.name,
          value: child.id,
        })),
      ];

      return {
        label: network.name,
        items: groupItems,
      } satisfies MultiSelectGroup;
    });

    const seen = new Set(grouped.flatMap((group) => group.items.map((item) => item.value)));
    const selectedOnlyItems = this.selectedStudioIds()
      .filter((studioId) => !seen.has(studioId))
      .map((studioId) => ({
        label: selectedLabels.get(studioId) ?? studioId,
        value: studioId,
      }));

    if (selectedOnlyItems.length > 0) {
      grouped.unshift({
        label: 'Selected',
        items: selectedOnlyItems,
      });
    }

    this.studioSelectOptions.set(grouped);
  }

  private studioLabelMap(): Map<string, string> {
    const labels = new Map<string, string>();

    for (const option of this.studioOptions()) {
      labels.set(option.id, option.name);
      for (const child of option.childStudios) {
        labels.set(child.id, child.name);
      }
    }

    return labels;
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
