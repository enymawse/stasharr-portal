import { HttpErrorResponse } from '@angular/common/http';
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
import { LibraryService } from '../../core/api/library.service';
import {
  LibrarySceneItem,
  LibrarySceneSort,
  LibrarySortDirection,
  LibraryStudioOption,
  LibraryTagMatchMode,
  LibraryTagOption,
} from '../../core/api/library.types';

interface MultiSelectOption {
  label: string;
  value: string;
}

interface SelectedChip {
  id: string;
  label: string;
}

@Component({
  selector: 'app-library-page',
  imports: [RouterLink, FormsModule, Message, ProgressSpinner, Select, MultiSelect],
  templateUrl: './library-page.component.html',
  styleUrl: './library-page.component.scss',
})
export class LibraryPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly PAGE_SIZE = 24;
  private static readonly SEARCH_DEBOUNCE_MS = 250;
  private static readonly DEFAULT_SORT: LibrarySceneSort = 'RELEASE_DATE';
  private static readonly DEFAULT_DIRECTION: LibrarySortDirection = 'DESC';
  private static readonly DEFAULT_TAG_MODE: LibraryTagMatchMode = 'OR';
  protected static readonly SORT_OPTIONS: Array<{
    value: LibrarySceneSort;
    label: string;
  }> = [
    { value: 'RELEASE_DATE', label: 'Release Date' },
    { value: 'UPDATED_AT', label: 'Recently Updated' },
    { value: 'CREATED_AT', label: 'Recently Added' },
    { value: 'TITLE', label: 'Title' },
  ];
  protected static readonly TAG_MATCH_OPTIONS: Array<{
    value: LibraryTagMatchMode;
    label: string;
  }> = [
    { value: 'OR', label: 'OR (Any)' },
    { value: 'AND', label: 'AND (All)' },
  ];

  private readonly libraryService = inject(LibraryService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly queryTerms = new Subject<string>();
  private readonly studioSearchTerms = new Subject<string>();
  private readonly tagSearchTerms = new Subject<string>();
  private querySubscription: Subscription | null = null;
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
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly hasMore = signal(true);
  protected readonly inFlight = signal(false);
  protected readonly items = signal<LibrarySceneItem[]>([]);
  protected readonly queryTerm = signal('');
  protected readonly selectedSort = signal<LibrarySceneSort>(LibraryPageComponent.DEFAULT_SORT);
  protected readonly selectedDirection = signal<LibrarySortDirection>(
    LibraryPageComponent.DEFAULT_DIRECTION,
  );
  protected readonly favoritePerformersOnly = signal(false);
  protected readonly favoriteStudiosOnly = signal(false);
  protected readonly favoriteTagsOnly = signal(false);
  protected readonly selectedTagMode = signal<LibraryTagMatchMode>(
    LibraryPageComponent.DEFAULT_TAG_MODE,
  );
  protected readonly tagSearchTerm = signal('');
  protected readonly selectedTags = signal<LibraryTagOption[]>([]);
  protected readonly selectedTagIdsModel = signal<string[]>([]);
  protected readonly tagOptions = signal<LibraryTagOption[]>([]);
  protected readonly tagSelectOptions = signal<MultiSelectOption[]>([]);
  protected readonly tagSearchLoading = signal(false);
  protected readonly tagSearchError = signal<string | null>(null);
  protected readonly studioSearchTerm = signal('');
  protected readonly selectedStudios = signal<SelectedChip[]>([]);
  protected readonly studioSelectedIdsModel = signal<string[]>([]);
  protected readonly studioOptions = signal<LibraryStudioOption[]>([]);
  protected readonly studioSelectOptions = signal<MultiSelectOption[]>([]);
  protected readonly studioSearchLoading = signal(false);
  protected readonly studioSearchError = signal<string | null>(null);
  protected readonly sortOptions = LibraryPageComponent.SORT_OPTIONS;
  protected readonly tagMatchOptions = LibraryPageComponent.TAG_MATCH_OPTIONS;

  ngOnInit(): void {
    this.setupQuerySearch();
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
    this.querySubscription?.unsubscribe();
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

  protected onQueryChanged(nextValue: string): void {
    const normalized = nextValue.trimStart();
    if (this.queryTerm() === normalized) {
      return;
    }

    this.queryTerm.set(normalized);
    this.syncUrlWithCurrentFilters(false);
    this.queryTerms.next(normalized);
  }

  protected onSortChanged(nextValue: string): void {
    if (
      nextValue !== 'UPDATED_AT' &&
      nextValue !== 'CREATED_AT' &&
      nextValue !== 'RELEASE_DATE' &&
      nextValue !== 'TITLE'
    ) {
      return;
    }

    if (this.selectedSort() === nextValue) {
      return;
    }

    this.selectedSort.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
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

  protected hasActiveFilters(): boolean {
    return (
      this.queryTerm().trim().length > 0 ||
      this.selectedSort() !== LibraryPageComponent.DEFAULT_SORT ||
      this.selectedDirection() !== LibraryPageComponent.DEFAULT_DIRECTION ||
      this.favoritePerformersOnly() ||
      this.favoriteStudiosOnly() ||
      this.favoriteTagsOnly() ||
      this.selectedTagMode() !== LibraryPageComponent.DEFAULT_TAG_MODE ||
      this.selectedTags().length > 0 ||
      this.selectedStudios().length > 0
    );
  }

  protected resetFilters(): void {
    if (!this.hasActiveFilters()) {
      return;
    }

    this.queryTerm.set('');
    this.selectedSort.set(LibraryPageComponent.DEFAULT_SORT);
    this.selectedDirection.set(LibraryPageComponent.DEFAULT_DIRECTION);
    this.favoritePerformersOnly.set(false);
    this.favoriteStudiosOnly.set(false);
    this.favoriteTagsOnly.set(false);
    this.selectedTagMode.set(LibraryPageComponent.DEFAULT_TAG_MODE);
    this.selectedTags.set([]);
    this.selectedTagIdsModel.set([]);
    this.tagSearchTerm.set('');
    this.tagOptions.set([]);
    this.tagSelectOptions.set([]);
    this.tagSearchError.set(null);
    this.selectedStudios.set([]);
    this.studioSelectedIdsModel.set([]);
    this.studioSearchTerm.set('');
    this.studioOptions.set([]);
    this.studioSelectOptions.set([]);
    this.studioSearchError.set(null);
    this.queryTerms.next('');
    this.tagSearchTerms.next('');
    this.studioSearchTerms.next('');
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected libraryTotalLabel(): string {
    return `Total scenes: ${this.total()}`;
  }

  protected libraryResultsNote(): string {
    return 'This page is served from the local library projection in the app database and includes local-only favorite overlays.';
  }

  protected emptyStateMessage(): string {
    return this.hasActiveFilters()
      ? 'No local scenes match the current filters.'
      : 'No local library scenes are indexed yet.';
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

  protected onFavoritePerformersOnlyChanged(nextValue: boolean): void {
    if (this.favoritePerformersOnly() === nextValue) {
      return;
    }

    this.favoritePerformersOnly.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected onFavoriteStudiosOnlyChanged(nextValue: boolean): void {
    if (this.favoriteStudiosOnly() === nextValue) {
      return;
    }

    this.favoriteStudiosOnly.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected onFavoriteTagsOnlyChanged(nextValue: boolean): void {
    if (this.favoriteTagsOnly() === nextValue) {
      return;
    }

    this.favoriteTagsOnly.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetFeedAndReload();
  }

  protected studioSelectEmptyMessage(): string {
    if (this.studioSearchError()) {
      return this.studioSearchError() ?? 'Failed to load studio options.';
    }

    if (this.studioSearchTerm().trim().length === 0) {
      return 'Type to search local studios.';
    }

    return 'No matching studios.';
  }

  protected tagSelectEmptyMessage(): string {
    if (this.tagSearchError()) {
      return this.tagSearchError() ?? 'Failed to load tag options.';
    }

    if (this.tagSearchTerm().trim().length === 0) {
      return 'Type to search local tags.';
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
    const currentLabels = new Map(this.studioOptions().map((option) => [option.id, option.name]));
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
      .filter((tag): tag is LibraryTagOption => Boolean(tag));
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

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  protected studioBadgeQueryParams(item: LibrarySceneItem): Record<string, string> | null {
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

    this.libraryService
      .getScenesFeed(nextPage, LibraryPageComponent.PAGE_SIZE, {
        query: this.queryTerm().trim() || undefined,
        sort: this.selectedSort(),
        direction: this.selectedDirection(),
        tagIds: this.selectedTagIds(),
        tagMode: this.selectedTagMode(),
        studioIds: this.selectedStudioIds(),
        favoritePerformersOnly: this.favoritePerformersOnly(),
        favoriteStudiosOnly: this.favoriteStudiosOnly(),
        favoriteTagsOnly: this.favoriteTagsOnly(),
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
        error: (error) => {
          if (requestVersion !== this.feedVersion) {
            return;
          }

          if (isInitialPage) {
            this.error.set(
              this.describeFeedError(error, 'Failed to load the local library feed from the API.'),
            );
          } else {
            this.loadMoreError.set(
              this.describeFeedError(error, 'Failed to load more local library scenes.'),
            );
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

  private describeFeedError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }

      if (Array.isArray(message) && message.length > 0) {
        return message.join(' ');
      }
    }

    return fallback;
  }

  private selectedTagIds(): string[] {
    return this.selectedTags().map((tag) => tag.id);
  }

  private selectedStudioIds(): string[] {
    return this.selectedStudios().map((studio) => studio.id);
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
    query: string;
    sort: LibrarySceneSort;
    direction: LibrarySortDirection;
    favoritePerformersOnly: boolean;
    favoriteStudiosOnly: boolean;
    favoriteTagsOnly: boolean;
    mode: LibraryTagMatchMode;
    tagIds: string[];
    tagNamesById: Map<string, string>;
    studioIds: string[];
    studioNamesById: Map<string, string>;
  } {
    const query = queryParamMap.get('query')?.trim() ?? '';
    const sortParam = queryParamMap.get('sort');
    const sort: LibrarySceneSort =
      sortParam === 'UPDATED_AT' ||
      sortParam === 'CREATED_AT' ||
      sortParam === 'RELEASE_DATE' ||
      sortParam === 'TITLE'
        ? sortParam
        : LibraryPageComponent.DEFAULT_SORT;
    const directionParam = queryParamMap.get('dir');
    const direction: LibrarySortDirection =
      directionParam === 'ASC' || directionParam === 'DESC'
        ? directionParam
        : LibraryPageComponent.DEFAULT_DIRECTION;
    const favoritePerformersOnly = ['1', 'true'].includes(
      queryParamMap.get('favoritePerformersOnly') ?? '',
    );
    const favoriteStudiosOnly = ['1', 'true'].includes(
      queryParamMap.get('favoriteStudiosOnly') ?? '',
    );
    const favoriteTagsOnly = ['1', 'true'].includes(queryParamMap.get('favoriteTagsOnly') ?? '');
    const modeParam = queryParamMap.get('mode');
    const mode: LibraryTagMatchMode =
      modeParam === 'OR' || modeParam === 'AND' ? modeParam : LibraryPageComponent.DEFAULT_TAG_MODE;

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

    return {
      query,
      sort,
      direction,
      favoritePerformersOnly,
      favoriteStudiosOnly,
      favoriteTagsOnly,
      mode,
      tagIds: this.dedupeStrings(rawTagIds),
      tagNamesById,
      studioIds: this.dedupeStrings(rawStudioIds),
      studioNamesById,
    };
  }

  private applyUrlState(state: {
    query: string;
    sort: LibrarySceneSort;
    direction: LibrarySortDirection;
    favoritePerformersOnly: boolean;
    favoriteStudiosOnly: boolean;
    favoriteTagsOnly: boolean;
    mode: LibraryTagMatchMode;
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
      this.queryTerm() !== state.query ||
      this.selectedSort() !== state.sort ||
      this.selectedDirection() !== state.direction ||
      this.favoritePerformersOnly() !== state.favoritePerformersOnly ||
      this.favoriteStudiosOnly() !== state.favoriteStudiosOnly ||
      this.favoriteTagsOnly() !== state.favoriteTagsOnly ||
      this.selectedTagMode() !== state.mode ||
      tagsChanged ||
      studiosChanged;

    if (!changed) {
      return false;
    }

    this.queryTerm.set(state.query);
    this.selectedSort.set(state.sort);
    this.selectedDirection.set(state.direction);
    this.favoritePerformersOnly.set(state.favoritePerformersOnly);
    this.favoriteStudiosOnly.set(state.favoriteStudiosOnly);
    this.favoriteTagsOnly.set(state.favoriteTagsOnly);
    this.selectedTagMode.set(state.mode);
    this.selectedTagIdsModel.set(state.tagIds);

    if (tagsChanged) {
      const previousTags = new Map(this.selectedTags().map((tag) => [tag.id, tag]));
      this.selectedTags.set(
        state.tagIds.map((id) => ({
          id,
          name: state.tagNamesById.get(id) ?? previousTags.get(id)?.name ?? id,
        })),
      );
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
      query: this.queryTerm().trim().length > 0 ? this.queryTerm().trim() : null,
      sort: this.selectedSort() === LibraryPageComponent.DEFAULT_SORT ? null : this.selectedSort(),
      dir:
        this.selectedDirection() === LibraryPageComponent.DEFAULT_DIRECTION
          ? null
          : this.selectedDirection(),
      favoritePerformersOnly: this.favoritePerformersOnly() ? '1' : null,
      favoriteStudiosOnly: this.favoriteStudiosOnly() ? '1' : null,
      favoriteTagsOnly: this.favoriteTagsOnly() ? '1' : null,
      mode:
        this.selectedTagMode() === LibraryPageComponent.DEFAULT_TAG_MODE
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
    if (
      (current.get('query') ?? null) === next.query &&
      (current.get('sort') ?? null) === next.sort &&
      (current.get('dir') ?? null) === next.dir &&
      (current.get('favoritePerformersOnly') ?? null) === next.favoritePerformersOnly &&
      (current.get('favoriteStudiosOnly') ?? null) === next.favoriteStudiosOnly &&
      (current.get('favoriteTagsOnly') ?? null) === next.favoriteTagsOnly &&
      (current.get('mode') ?? null) === next.mode &&
      (current.get('tags') ?? null) === next.tags &&
      (current.get('tagNames') ?? null) === next.tagNames &&
      (current.get('studios') ?? null) === next.studios &&
      (current.get('studioNames') ?? null) === next.studioNames
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

  private setupQuerySearch(): void {
    this.querySubscription = this.queryTerms
      .pipe(
        map((value) => value.trim()),
        debounceTime(LibraryPageComponent.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
      )
      .subscribe(() => {
        this.resetFeedAndReload();
      });
  }

  private setupTagSearch(): void {
    this.tagSearchSubscription = this.tagSearchTerms
      .pipe(
        map((value) => value.trim()),
        debounceTime(LibraryPageComponent.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query) {
            this.tagOptions.set([]);
            this.tagSelectOptions.set(this.selectedTagsToSelectOptions());
            this.tagSearchError.set(null);
            return of<LibraryTagOption[]>([]);
          }

          this.tagSearchLoading.set(true);
          this.tagSearchError.set(null);

          return this.libraryService.searchTags(query).pipe(
            catchError(() => {
              this.tagSearchError.set('Failed to load tag options.');
              return of<LibraryTagOption[]>([]);
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
        debounceTime(LibraryPageComponent.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query) {
            this.studioOptions.set([]);
            this.rebuildStudioSelectOptions([]);
            this.studioSearchError.set(null);
            return of<LibraryStudioOption[]>([]);
          }

          this.studioSearchLoading.set(true);
          this.studioSearchError.set(null);

          return this.libraryService.searchStudios(query).pipe(
            catchError(() => {
              this.studioSearchError.set('Failed to load studio options.');
              return of<LibraryStudioOption[]>([]);
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

  private rebuildTagSelectOptions(searchResults: LibraryTagOption[]): void {
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

  private rebuildStudioSelectOptions(options: LibraryStudioOption[]): void {
    const merged = new Map<string, MultiSelectOption>();

    for (const selected of this.selectedStudios()) {
      merged.set(selected.id, {
        label: selected.label,
        value: selected.id,
      });
    }

    for (const option of options) {
      merged.set(option.id, {
        label: option.name,
        value: option.id,
      });
    }

    this.studioSelectOptions.set([...merged.values()]);
  }

  private isTagSelected(tagId: string): boolean {
    return this.selectedTags().some((tag) => tag.id === tagId);
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
