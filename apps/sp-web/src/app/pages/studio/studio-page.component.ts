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
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import {
  Subject,
  Subscription,
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  finalize,
  map,
  of,
  switchMap,
} from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { MultiSelect } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { DiscoverService } from '../../core/api/discover.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import {
  DiscoverItem,
  SceneFavoritesFilter,
  SceneFeedSort,
  SceneRequestContext,
  SceneTagMatchMode,
  SceneTagOption,
  SortDirection,
  StudioDetails,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

type FavoritesFilterOption = 'NONE' | SceneFavoritesFilter;

interface MultiSelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-studio-page',
  imports: [
    RouterLink,
    FormsModule,
    Message,
    ProgressSpinner,
    Select,
    MultiSelect,
    ButtonDirective,
    SceneStatusBadgeComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './studio-page.component.html',
  styleUrl: './studio-page.component.scss',
})
export class StudioPageComponent implements OnInit, AfterViewInit, OnDestroy {
  private static readonly SCENES_PAGE_SIZE = 25;
  private static readonly SEARCH_DEBOUNCE_MS = 250;
  private static readonly DEFAULT_SCENE_SORT: SceneFeedSort = 'DATE';
  private static readonly DEFAULT_SCENE_DIRECTION: SortDirection = 'DESC';
  private static readonly DEFAULT_FAVORITES: FavoritesFilterOption = 'NONE';
  private static readonly DEFAULT_TAG_MODE: SceneTagMatchMode = 'OR';

  protected static readonly SCENE_SORT_OPTIONS: Array<{
    value: SceneFeedSort;
    label: string;
  }> = [
    { value: 'DATE', label: 'Date' },
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

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly discoverService = inject(DiscoverService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly tagSearchTerms = new Subject<string>();
  private routeSubscription: Subscription | null = null;
  private tagSearchSubscription: Subscription | null = null;
  private observer: IntersectionObserver | null = null;
  private sentinelElement: HTMLDivElement | null = null;
  private sentinelIntersecting = false;
  private scenesFeedVersion = 0;
  private pendingScenesReload = false;
  private hasHydratedFilterState = false;

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

  protected readonly studioId = signal<string | null>(null);
  protected readonly studio = signal<StudioDetails | null>(null);
  protected readonly loadingStudio = signal(false);
  protected readonly studioError = signal<string | null>(null);
  protected readonly activeImageIndex = signal(0);
  protected readonly favoritingStudio = signal(false);

  protected readonly sceneSort = signal<SceneFeedSort>(StudioPageComponent.DEFAULT_SCENE_SORT);
  protected readonly sceneSortDirection = signal<SortDirection>(
    StudioPageComponent.DEFAULT_SCENE_DIRECTION,
  );
  protected readonly selectedFavorites = signal<FavoritesFilterOption>(
    StudioPageComponent.DEFAULT_FAVORITES,
  );
  protected readonly selectedTagMode = signal<SceneTagMatchMode>(
    StudioPageComponent.DEFAULT_TAG_MODE,
  );
  protected readonly tagSearchTerm = signal('');
  protected readonly selectedTags = signal<SceneTagOption[]>([]);
  protected readonly tagSelectedIdsModel = signal<string[]>([]);
  protected readonly tagOptions = signal<SceneTagOption[]>([]);
  protected readonly tagSelectOptions = signal<MultiSelectOption[]>([]);
  protected readonly tagSearchLoading = signal(false);
  protected readonly tagSearchError = signal<string | null>(null);

  protected readonly loadingScenes = signal(false);
  protected readonly loadingMoreScenes = signal(false);
  protected readonly scenesError = signal<string | null>(null);
  protected readonly loadMoreScenesError = signal<string | null>(null);
  protected readonly scenesTotal = signal(0);
  protected readonly scenesPage = signal(0);
  protected readonly scenesHasMore = signal(true);
  protected readonly scenesInFlight = signal(false);
  protected readonly scenes = signal<DiscoverItem[]>([]);

  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);

  protected readonly backLinkPath = signal('/studios');
  protected readonly backLinkQueryParams = signal<Params>({});
  protected readonly backLinkLabel = signal('Back to Studios');

  protected readonly sceneSortOptions = StudioPageComponent.SCENE_SORT_OPTIONS;
  protected readonly favoritesOptions = StudioPageComponent.FAVORITES_OPTIONS;
  protected readonly tagMatchOptions = StudioPageComponent.TAG_MATCH_OPTIONS;

  ngOnInit(): void {
    this.setupTagSearch();
    this.routeSubscription = combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
    ]).subscribe(([paramMap, queryParamMap]) => {
      const resolvedBackLink = this.parseReturnTo(queryParamMap.get('returnTo'), '/studios');
      this.backLinkPath.set(resolvedBackLink.path);
      this.backLinkQueryParams.set(resolvedBackLink.queryParams);
      this.backLinkLabel.set(this.backLinkText(resolvedBackLink.path, 'Back to Studios'));

      const nextStudioId = paramMap.get('studioId')?.trim() ?? '';
      if (!nextStudioId) {
        this.studioId.set(null);
        this.studio.set(null);
        this.studioError.set('Studio id is missing from the route.');
        return;
      }

      const studioChanged = this.studioId() !== nextStudioId;
      this.studioId.set(nextStudioId);
      if (studioChanged) {
        this.loadStudio();
      }

      const changedByUrl = this.applyUrlFilterState(this.readUrlFilterState(queryParamMap));
      if (!this.hasHydratedFilterState || studioChanged || changedByUrl) {
        this.hasHydratedFilterState = true;
        this.resetScenesAndReload();
        return;
      }

      this.hasHydratedFilterState = true;
    });
  }

  ngAfterViewInit(): void {
    this.setupIntersectionObserver();
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.tagSearchSubscription?.unsubscribe();
    if (this.observer && this.sentinelElement) {
      this.observer.unobserve(this.sentinelElement);
    }
    this.observer?.disconnect();
  }

  protected retryStudioLoad(): void {
    this.loadStudio();
  }

  protected hasStudio(): boolean {
    return this.studio() !== null;
  }

  protected hasScenes(): boolean {
    return this.scenes().length > 0;
  }

  protected retryInitialScenesLoad(): void {
    if (this.scenesInFlight()) {
      return;
    }

    this.scenesError.set(null);
    this.loadNextScenesPage();
  }

  protected retryLoadMoreScenes(): void {
    if (this.scenesInFlight() || !this.scenesHasMore()) {
      return;
    }

    this.loadMoreScenesError.set(null);
    this.loadNextScenesPage();
  }

  protected activeStudioImageUrl(): string | null {
    const images = this.studio()?.images ?? [];
    if (images.length === 0) {
      return this.studio()?.imageUrl ?? null;
    }

    const index = this.activeImageIndex();
    if (index < 0 || index >= images.length) {
      return images[0]?.url ?? null;
    }

    return images[index]?.url ?? null;
  }

  protected setActiveImage(index: number): void {
    const imageCount = this.studio()?.images.length ?? 0;
    if (imageCount === 0) {
      return;
    }

    const nextIndex = Math.min(Math.max(index, 0), imageCount - 1);
    this.activeImageIndex.set(nextIndex);
  }

  protected nextImage(): void {
    const imageCount = this.studio()?.images.length ?? 0;
    if (imageCount === 0) {
      return;
    }

    this.activeImageIndex.set((this.activeImageIndex() + 1) % imageCount);
  }

  protected previousImage(): void {
    const imageCount = this.studio()?.images.length ?? 0;
    if (imageCount === 0) {
      return;
    }

    this.activeImageIndex.set((this.activeImageIndex() - 1 + imageCount) % imageCount);
  }

  protected metadataRows(studio: StudioDetails): Array<{ label: string; value: string }> {
    const rows: Array<{ label: string; value: string }> = [];
    const pushIfValue = (label: string, value: string | number | null) => {
      if (value === null || value === undefined || value === '') {
        return;
      }
      rows.push({ label, value: String(value) });
    };

    pushIfValue('Created', studio.createdAt);
    pushIfValue('Updated', studio.updatedAt);

    return rows;
  }

  protected childInitial(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '?';
  }

  protected canToggleFavoriteStudio(studio: StudioDetails): boolean {
    return studio.id.length > 0 && !this.favoritingStudio();
  }

  protected toggleFavoriteStudio(studio: StudioDetails): void {
    if (this.favoritingStudio()) {
      return;
    }

    const nextFavorite = !studio.isFavorite;
    this.favoritingStudio.set(true);
    this.discoverService
      .favoriteStudio(studio.id, nextFavorite)
      .pipe(
        finalize(() => {
          this.favoritingStudio.set(false);
        }),
      )
      .subscribe({
        next: (result) => {
          this.studio.update((current) =>
            current ? { ...current, isFavorite: nextFavorite } : current,
          );

          if (nextFavorite && result.alreadyFavorited) {
            this.notifications.info('Studio already favorited');
            return;
          }

          this.notifications.success(nextFavorite ? 'Studio favorited' : 'Studio unfavorited');
        },
        error: () => {
          this.notifications.error(
            nextFavorite ? 'Failed to favorite studio' : 'Failed to unfavorite studio',
          );
        },
      });
  }

  protected studioFavoriteLabel(studio: StudioDetails): string {
    return studio.isFavorite ? 'Unfavorite studio' : 'Favorite studio';
  }

  protected onSceneSortChanged(nextValue: string): void {
    if (
      nextValue === 'DATE' ||
      nextValue === 'TITLE' ||
      nextValue === 'TRENDING' ||
      nextValue === 'CREATED_AT' ||
      nextValue === 'UPDATED_AT'
    ) {
      if (this.sceneSort() === nextValue) {
        return;
      }

      this.sceneSort.set(nextValue);
      this.syncUrlWithCurrentFilters(false);
      this.resetScenesAndReload();
    }
  }

  protected onSceneSortDirectionChanged(nextValue: string): void {
    if (nextValue !== 'ASC' && nextValue !== 'DESC') {
      return;
    }

    if (this.sceneSortDirection() === nextValue) {
      return;
    }

    this.sceneSortDirection.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetScenesAndReload();
  }

  protected toggleSceneSortDirection(): void {
    this.onSceneSortDirectionChanged(this.sceneSortDirection() === 'ASC' ? 'DESC' : 'ASC');
  }

  protected sceneSortDirectionIconClass(): string {
    return this.sceneSortDirection() === 'ASC'
      ? 'pi pi-sort-amount-up-alt'
      : 'pi pi-sort-amount-down-alt';
  }

  protected sceneSortDirectionToggleLabel(): string {
    return this.sceneSortDirection() === 'ASC'
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
      this.resetScenesAndReload();
    }
  }

  protected onTagFilterChanged(nextValue: string | null | undefined): void {
    const nextTerm = (nextValue ?? '').trimStart();
    this.tagSearchTerm.set(nextTerm);
    this.tagSearchTerms.next(nextTerm);
  }

  protected onTagFilterPanelHide(): void {
    this.onTagFilterChanged('');
  }

  protected onTagSelectionChanged(nextValue: string[] | null): void {
    const nextIds = this.dedupeStrings(nextValue ?? []);
    this.tagSelectedIdsModel.set(nextIds);

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

    this.resetScenesAndReload();
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
      this.resetScenesAndReload();
    }
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

  protected isTagSelected(tagId: string): boolean {
    return this.selectedTags().some((tag) => tag.id === tagId);
  }

  protected isRequestable(item: DiscoverItem): boolean {
    return isSceneStatusRequestable(item.status);
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
    this.scenes.update((current) =>
      current.map((item) =>
        item.id === stashId ? { ...item, status: { state: 'REQUESTED' } } : item,
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

  private loadStudio(): void {
    const currentStudioId = this.studioId();
    if (!currentStudioId) {
      return;
    }

    this.loadingStudio.set(true);
    this.studioError.set(null);
    this.activeImageIndex.set(0);

    this.discoverService
      .getStudioDetails(currentStudioId)
      .pipe(
        finalize(() => {
          this.loadingStudio.set(false);
        }),
      )
      .subscribe({
        next: (details) => {
          this.studio.set(details);
          this.activeImageIndex.set(0);
        },
        error: () => {
          this.studioError.set('Failed to load studio details.');
        },
      });
  }

  private loadNextScenesPage(): void {
    const currentStudioId = this.studioId();
    if (!currentStudioId || this.scenesInFlight() || !this.scenesHasMore()) {
      return;
    }

    const nextPage = this.scenesPage() + 1;
    const isInitialPage = nextPage === 1;
    const requestVersion = this.scenesFeedVersion;
    this.scenesInFlight.set(true);

    if (isInitialPage) {
      this.loadingScenes.set(true);
      this.scenesError.set(null);
    } else {
      this.loadingMoreScenes.set(true);
      this.loadMoreScenesError.set(null);
    }

    this.discoverService
      .getScenesFeed(
        nextPage,
        StudioPageComponent.SCENES_PAGE_SIZE,
        this.sceneSort(),
        this.sceneSortDirection(),
        this.selectedTagIds(),
        this.selectedTagMode(),
        this.selectedFavoritesFilter(),
        [currentStudioId],
      )
      .pipe(
        finalize(() => {
          this.scenesInFlight.set(false);

          if (requestVersion !== this.scenesFeedVersion) {
            if (this.pendingScenesReload) {
              this.pendingScenesReload = false;
              this.loadNextScenesPage();
            }
            return;
          }

          if (isInitialPage) {
            this.loadingScenes.set(false);
          } else {
            this.loadingMoreScenes.set(false);
          }

          if (this.sentinelIntersecting && this.scenesHasMore()) {
            this.loadNextScenesPage();
          }
        }),
      )
      .subscribe({
        next: (response) => {
          if (requestVersion !== this.scenesFeedVersion) {
            return;
          }

          this.scenesTotal.set(response.total ?? 0);
          this.scenesPage.set(response.page);
          this.scenesHasMore.set(response.hasMore);
          this.scenes.update((current) =>
            isInitialPage ? response.items : [...current, ...response.items],
          );
        },
        error: () => {
          if (requestVersion !== this.scenesFeedVersion) {
            return;
          }

          if (isInitialPage) {
            this.scenesError.set('Failed to load studio scenes.');
          } else {
            this.loadMoreScenesError.set('Failed to load more studio scenes.');
          }
        },
      });
  }

  private resetScenesAndReload(): void {
    this.scenesFeedVersion += 1;
    this.pendingScenesReload = false;
    this.scenesPage.set(0);
    this.scenesTotal.set(0);
    this.scenesHasMore.set(true);
    this.scenes.set([]);
    this.loadingScenes.set(false);
    this.loadingMoreScenes.set(false);
    this.scenesError.set(null);
    this.loadMoreScenesError.set(null);

    if (this.scenesInFlight()) {
      this.pendingScenesReload = true;
      return;
    }

    this.loadNextScenesPage();
  }

  private setupTagSearch(): void {
    this.tagSearchSubscription = this.tagSearchTerms
      .pipe(
        map((value) => value.trim()),
        debounceTime(StudioPageComponent.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query) {
            this.tagOptions.set([]);
            this.rebuildTagSelectOptions([]);
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

  private selectedTagIds(): string[] {
    return this.selectedTags().map((tag) => tag.id);
  }

  private selectedFavoritesFilter(): SceneFavoritesFilter | undefined {
    const favorites = this.selectedFavorites();
    return favorites === 'NONE' ? undefined : favorites;
  }

  private readUrlFilterState(queryParamMap: import('@angular/router').ParamMap): {
    sort: SceneFeedSort;
    direction: SortDirection;
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
        : StudioPageComponent.DEFAULT_SCENE_SORT;

    const directionParam = queryParamMap.get('dir');
    const direction: SortDirection =
      directionParam === 'ASC' || directionParam === 'DESC'
        ? directionParam
        : StudioPageComponent.DEFAULT_SCENE_DIRECTION;

    const favoritesParam = queryParamMap.get('fav');
    const favorites: FavoritesFilterOption =
      favoritesParam === 'NONE' ||
      favoritesParam === 'ALL' ||
      favoritesParam === 'PERFORMER' ||
      favoritesParam === 'STUDIO'
        ? favoritesParam
        : StudioPageComponent.DEFAULT_FAVORITES;

    const modeParam = queryParamMap.get('mode');
    const mode: SceneTagMatchMode =
      modeParam === 'OR' || modeParam === 'AND' ? modeParam : StudioPageComponent.DEFAULT_TAG_MODE;

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

    return {
      sort,
      direction,
      favorites,
      mode,
      tagIds: this.dedupeStrings(rawTagIds),
      tagNamesById,
    };
  }

  private applyUrlFilterState(state: {
    sort: SceneFeedSort;
    direction: SortDirection;
    favorites: FavoritesFilterOption;
    mode: SceneTagMatchMode;
    tagIds: string[];
    tagNamesById: Map<string, string>;
  }): boolean {
    const currentTagIds = this.selectedTagIds();
    const tagsChanged = !this.areStringArraysEqual(currentTagIds, state.tagIds);
    const changed =
      this.sceneSort() !== state.sort ||
      this.sceneSortDirection() !== state.direction ||
      this.selectedFavorites() !== state.favorites ||
      this.selectedTagMode() !== state.mode ||
      tagsChanged;

    if (!changed) {
      return false;
    }

    this.sceneSort.set(state.sort);
    this.sceneSortDirection.set(state.direction);
    this.selectedFavorites.set(state.favorites);
    this.selectedTagMode.set(state.mode);
    this.tagSelectedIdsModel.set(state.tagIds);

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
      sort: this.sceneSort() === StudioPageComponent.DEFAULT_SCENE_SORT ? null : this.sceneSort(),
      dir:
        this.sceneSortDirection() === StudioPageComponent.DEFAULT_SCENE_DIRECTION
          ? null
          : this.sceneSortDirection(),
      fav:
        this.selectedFavorites() === StudioPageComponent.DEFAULT_FAVORITES
          ? null
          : this.selectedFavorites(),
      mode:
        this.selectedTagMode() === StudioPageComponent.DEFAULT_TAG_MODE
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
    if (
      (current.get('sort') ?? null) === next.sort &&
      (current.get('dir') ?? null) === next.dir &&
      (current.get('fav') ?? null) === next.fav &&
      (current.get('mode') ?? null) === next.mode &&
      (current.get('tags') ?? null) === next.tags &&
      (current.get('tagNames') ?? null) === next.tagNames
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

  private parseReturnTo(
    rawReturnTo: string | null,
    fallback: string,
  ): { path: string; queryParams: Params } {
    const trimmed = rawReturnTo?.trim();
    if (!trimmed) {
      return { path: fallback, queryParams: {} };
    }

    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
      return { path: fallback, queryParams: {} };
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
      return { path: fallback, queryParams: {} };
    }

    try {
      const parsed = this.router.parseUrl(trimmed);
      const primarySegments = parsed.root.children['primary']?.segments ?? [];
      const path = `/${primarySegments.map((segment) => segment.path).join('/')}`;
      return {
        path: path === '/' ? fallback : path,
        queryParams: parsed.queryParams,
      };
    } catch {
      return { path: fallback, queryParams: {} };
    }
  }

  private backLinkText(returnTo: string, fallbackLabel: string): string {
    if (returnTo.startsWith('/studios')) {
      return 'Back to Studios';
    }
    if (returnTo.startsWith('/studio/')) {
      return 'Back to Studio';
    }
    if (returnTo.startsWith('/scenes')) {
      return 'Back to Scenes';
    }
    if (returnTo.startsWith('/discover')) {
      return 'Back to Discover';
    }
    if (returnTo.startsWith('/acquisition')) {
      return 'Back to Acquisition';
    }
    if (returnTo.startsWith('/performer/')) {
      return 'Back to Performer';
    }

    return fallbackLabel;
  }

  private rebuildTagSelectOptions(searchResults: SceneTagOption[]): void {
    const merged = new Map<string, MultiSelectOption>();

    for (const tag of this.selectedTags()) {
      merged.set(tag.id, {
        label: tag.name,
        value: tag.id,
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

          if (this.scenesInFlight() || !this.scenesHasMore()) {
            return;
          }

          this.loadNextScenesPage();
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
