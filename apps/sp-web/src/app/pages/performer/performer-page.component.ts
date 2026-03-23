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
  combineLatest,
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
import { ToggleSwitch } from 'primeng/toggleswitch';
import { DiscoverService } from '../../core/api/discover.service';
import {
  DiscoverItem,
  PerformerDetails,
  PerformerGender,
  PerformerStudioOption,
  SceneFeedSort,
  SceneRequestContext,
  SceneTagOption,
} from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

interface SelectedStudioChip {
  id: string;
  label: string;
}

interface MultiSelectOption {
  label: string;
  value: string;
}

interface MultiSelectGroup {
  label: string;
  items: MultiSelectOption[];
}

@Component({
  selector: 'app-performer-page',
  imports: [
    RouterLink,
    FormsModule,
    Select,
    ToggleSwitch,
    InputText,
    Message,
    ProgressSpinner,
    MultiSelect,
    SceneStatusBadgeComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './performer-page.component.html',
  styleUrl: './performer-page.component.scss',
})
export class PerformerPageComponent
  implements OnInit, AfterViewInit, OnDestroy
{
  private static readonly SCENES_PAGE_SIZE = 25;
  private static readonly SEARCH_DEBOUNCE_MS = 250;
  private static readonly DEFAULT_SORT: SceneFeedSort = 'DATE';

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

  private readonly discoverService = inject(DiscoverService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly studioSearchTerms = new Subject<string>();
  private readonly tagSearchTerms = new Subject<string>();
  private routeSubscription: Subscription | null = null;
  private studioSearchSubscription: Subscription | null = null;
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

  protected readonly performerId = signal<string | null>(null);
  protected readonly performer = signal<PerformerDetails | null>(null);
  protected readonly loadingPerformer = signal(false);
  protected readonly performerError = signal<string | null>(null);
  protected readonly activeImageIndex = signal(0);

  protected readonly sceneSort = signal<SceneFeedSort>(PerformerPageComponent.DEFAULT_SORT);
  protected readonly onlyFavoriteStudios = signal(false);
  protected readonly studioSearchTerm = signal('');
  protected readonly selectedStudios = signal<SelectedStudioChip[]>([]);
  protected readonly studioOptions = signal<PerformerStudioOption[]>([]);
  protected readonly studioSearchLoading = signal(false);
  protected readonly studioSearchError = signal<string | null>(null);
  protected readonly studioSelectedIds = signal<string[]>([]);
  protected readonly studioSelectOptions = signal<MultiSelectGroup[]>([]);
  protected readonly tagSearchTerm = signal('');
  protected readonly selectedTags = signal<SceneTagOption[]>([]);
  protected readonly tagOptions = signal<SceneTagOption[]>([]);
  protected readonly tagSearchLoading = signal(false);
  protected readonly tagSearchError = signal<string | null>(null);
  protected readonly tagSelectedIds = signal<string[]>([]);
  protected readonly tagSelectOptions = signal<MultiSelectOption[]>([]);
  protected readonly sceneSortOptions = PerformerPageComponent.SCENE_SORT_OPTIONS;

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
  protected readonly backLinkPath = signal('/performers');
  protected readonly backLinkQueryParams = signal<Params>({});
  protected readonly backLinkLabel = signal('Back to Performers');

  ngOnInit(): void {
    this.setupStudioSearch();
    this.setupTagSearch();
    this.routeSubscription = combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
    ]).subscribe(([params, queryParamMap]) => {
      const resolvedBackLink = this.parseReturnTo(queryParamMap.get('returnTo'), '/performers');
      this.backLinkPath.set(resolvedBackLink.path);
      this.backLinkQueryParams.set(resolvedBackLink.queryParams);
      this.backLinkLabel.set(this.backLinkText(resolvedBackLink.path, 'Back to Performers'));

      const nextPerformerId = params.get('performerId')?.trim() ?? '';
      if (!nextPerformerId) {
        this.performerId.set(null);
        this.performer.set(null);
        this.performerError.set('Performer id is missing from the route.');
        return;
      }

      const performerChanged = this.performerId() !== nextPerformerId;
      this.performerId.set(nextPerformerId);
      if (performerChanged) {
        this.loadPerformer();
      }

      const changedByUrl = this.applyUrlFilterState(this.readUrlFilterState(queryParamMap));
      if (!this.hasHydratedFilterState || performerChanged || changedByUrl) {
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
    this.studioSearchSubscription?.unsubscribe();
    this.tagSearchSubscription?.unsubscribe();
    if (this.observer && this.sentinelElement) {
      this.observer.unobserve(this.sentinelElement);
    }
    this.observer?.disconnect();
  }

  protected hasPerformer(): boolean {
    return this.performer() !== null;
  }

  protected retryPerformerLoad(): void {
    this.loadPerformer();
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

  protected selectedStudiosIds(): string[] {
    return this.selectedStudios().map((studio) => studio.id);
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
    this.scenes.update((current) =>
      current.map((item) =>
        item.id === stashId ? { ...item, status: { state: 'DOWNLOADING' } } : item,
      ),
    );
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

  protected onOnlyFavoriteStudiosChanged(nextValue: boolean): void {
    if (this.onlyFavoriteStudios() === nextValue) {
      return;
    }

    this.onlyFavoriteStudios.set(nextValue);
    this.syncUrlWithCurrentFilters(false);
    this.resetScenesAndReload();
  }

  protected onStudioSearchChanged(nextValue: string): void {
    this.studioSearchTerm.set(nextValue);
    this.studioSearchTerms.next(nextValue);
  }

  protected onStudioSelectionChanged(nextValue: string[] | null): void {
    const nextIds = this.dedupeStrings(nextValue ?? []);
    this.studioSelectedIds.set(nextIds);

    const changed =
      nextIds.length !== this.selectedStudios().length ||
      nextIds.some((id) => !this.isStudioSelected(id));

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
    this.syncUrlWithCurrentFilters(false);
    this.resetScenesAndReload();
  }

  protected onTagSelectionChanged(nextValue: string[] | null): void {
    const nextIds = this.dedupeStrings(nextValue ?? []);
    this.tagSelectedIds.set(nextIds);

    const previousTags = new Map(this.selectedTags().map((tag) => [tag.id, tag]));
    const currentTags = new Map(this.tagOptions().map((tag) => [tag.id, tag]));
    const next = nextIds
      .map((id) => currentTags.get(id) ?? previousTags.get(id))
      .filter((tag): tag is SceneTagOption => Boolean(tag));
    const current = this.selectedTags();
    const changed =
      next.length !== current.length || next.some((tag) => !this.isTagSelected(tag.id));

    this.selectedTags.set(next);
    this.rebuildTagSelectOptions(this.tagOptions());
    this.syncUrlWithCurrentFilters(false);

    if (!changed) {
      return;
    }

    this.resetScenesAndReload();
  }

  protected onTagSearchChanged(nextValue: string): void {
    this.tagSearchTerm.set(nextValue);
    this.tagSearchTerms.next(nextValue);
  }

  protected isStudioSelected(studioId: string): boolean {
    return this.selectedStudios().some((studio) => studio.id === studioId);
  }

  protected isTagSelected(tagId: string): boolean {
    return this.selectedTags().some((tag) => tag.id === tagId);
  }

  protected hasCarouselImages(): boolean {
    return (this.performer()?.images.length ?? 0) > 0;
  }

  protected activeCarouselImageUrl(): string | null {
    const images = this.performer()?.images ?? [];
    if (images.length === 0) {
      return this.performer()?.imageUrl ?? null;
    }

    const index = this.activeImageIndex();
    if (index < 0 || index >= images.length) {
      return images[0]?.url ?? null;
    }

    return images[index]?.url ?? null;
  }

  protected setActiveImage(index: number): void {
    const imageCount = this.performer()?.images.length ?? 0;
    if (imageCount === 0) {
      return;
    }

    const nextIndex = Math.min(Math.max(index, 0), imageCount - 1);
    this.activeImageIndex.set(nextIndex);
  }

  protected nextImage(): void {
    const imageCount = this.performer()?.images.length ?? 0;
    if (imageCount === 0) {
      return;
    }

    this.activeImageIndex.set((this.activeImageIndex() + 1) % imageCount);
  }

  protected previousImage(): void {
    const imageCount = this.performer()?.images.length ?? 0;
    if (imageCount === 0) {
      return;
    }

    this.activeImageIndex.set(
      (this.activeImageIndex() - 1 + imageCount) % imageCount,
    );
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

  protected metadataRows(performer: PerformerDetails): Array<{ label: string; value: string }> {
    const rows: Array<{ label: string; value: string }> = [];
    const pushIfValue = (label: string, value: string | number | null) => {
      if (value === null || value === undefined || value === '') {
        return;
      }
      rows.push({ label, value: String(value) });
    };

    pushIfValue('Gender', this.formattedGender(performer.gender));
    pushIfValue('Age', performer.age);
    pushIfValue('Birth Date', performer.birthDate);
    pushIfValue('Country', performer.country);
    pushIfValue('Ethnicity', performer.ethnicity);
    pushIfValue('Eye Color', performer.eyeColor);
    pushIfValue('Hair Color', performer.hairColor);
    pushIfValue('Height', performer.height);
    pushIfValue('Cup Size', performer.cupSize);
    pushIfValue('Band Size', performer.bandSize);
    pushIfValue('Waist Size', performer.waistSize);
    pushIfValue('Hip Size', performer.hipSize);
    pushIfValue('Breast Type', performer.breastType);
    pushIfValue('Career Start Year', performer.careerStartYear);
    pushIfValue('Career End Year', performer.careerEndYear);
    pushIfValue('Created', performer.createdAt);
    pushIfValue('Updated', performer.updatedAt);

    return rows;
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

  private loadPerformer(): void {
    const currentPerformerId = this.performerId();
    if (!currentPerformerId) {
      return;
    }

    this.loadingPerformer.set(true);
    this.performerError.set(null);

    this.discoverService
      .getPerformerDetails(currentPerformerId)
      .pipe(
        finalize(() => {
          this.loadingPerformer.set(false);
        }),
      )
      .subscribe({
        next: (details) => {
          this.performer.set(details);
          this.activeImageIndex.set(0);
        },
        error: () => {
          this.performerError.set('Failed to load performer details.');
        },
      });
  }

  private loadNextScenesPage(): void {
    const currentPerformerId = this.performerId();
    if (!currentPerformerId || this.scenesInFlight() || !this.scenesHasMore()) {
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
      .getPerformerScenesFeed(
        currentPerformerId,
        nextPage,
        PerformerPageComponent.SCENES_PAGE_SIZE,
        {
          sort: this.sceneSort(),
          studioIds: this.selectedStudiosIds(),
          tagIds: this.selectedTags().map((tag) => tag.id),
          onlyFavoriteStudios: this.onlyFavoriteStudios(),
        },
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

          this.scenesTotal.set(response.total);
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
            this.scenesError.set('Failed to load performer scenes.');
          } else {
            this.loadMoreScenesError.set('Failed to load more performer scenes.');
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

  private setupStudioSearch(): void {
    this.studioSearchSubscription = this.studioSearchTerms
      .pipe(
        map((value) => value.trim()),
        debounceTime(PerformerPageComponent.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query) {
            this.studioOptions.set([]);
            this.studioSelectOptions.set([]);
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
        this.studioSelectOptions.set(
          options.map((network) => ({
            label: network.name,
            items: [
              {
                label: `${network.name} (Network)`,
                value: network.id,
              },
              ...network.childStudios.map((child) => ({
                label: child.name,
                value: child.id,
              })),
            ],
          })),
        );
      });
  }

  private readUrlFilterState(queryParamMap: import('@angular/router').ParamMap): {
    sort: SceneFeedSort;
    onlyFavoriteStudios: boolean;
    studioIds: string[];
    tagIds: string[];
  } {
    const sortParam = queryParamMap.get('sort');
    const sort: SceneFeedSort =
      sortParam === 'DATE' ||
      sortParam === 'TITLE' ||
      sortParam === 'TRENDING' ||
      sortParam === 'CREATED_AT' ||
      sortParam === 'UPDATED_AT'
        ? sortParam
        : PerformerPageComponent.DEFAULT_SORT;

    const onlyFavoriteStudiosParam = queryParamMap.get('favStudios');
    const onlyFavoriteStudios =
      onlyFavoriteStudiosParam === '1' || onlyFavoriteStudiosParam === 'true';

    const studioIds = this.dedupeStrings(
      (queryParamMap.get('studios') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    );

    const tagIds = this.dedupeStrings(
      (queryParamMap.get('tags') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    );

    return {
      sort,
      onlyFavoriteStudios,
      studioIds,
      tagIds,
    };
  }

  private applyUrlFilterState(state: {
    sort: SceneFeedSort;
    onlyFavoriteStudios: boolean;
    studioIds: string[];
    tagIds: string[];
  }): boolean {
    const currentStudioIds = this.selectedStudiosIds();
    const currentTagIds = this.selectedTags().map((tag) => tag.id);
    const studiosChanged = !this.areStringArraysEqual(currentStudioIds, state.studioIds);
    const tagsChanged = !this.areStringArraysEqual(currentTagIds, state.tagIds);
    const changed =
      this.sceneSort() !== state.sort ||
      this.onlyFavoriteStudios() !== state.onlyFavoriteStudios ||
      studiosChanged ||
      tagsChanged;

    if (!changed) {
      return false;
    }

    this.sceneSort.set(state.sort);
    this.onlyFavoriteStudios.set(state.onlyFavoriteStudios);

    if (studiosChanged) {
      const previousLabels = new Map(
        this.selectedStudios().map((studio) => [studio.id, studio.label]),
      );
      this.selectedStudios.set(
        state.studioIds.map((id) => ({
          id,
          label: previousLabels.get(id) ?? id,
        })),
      );
      this.studioSelectedIds.set(state.studioIds);
    }

    if (tagsChanged) {
      const previousTags = new Map(this.selectedTags().map((tag) => [tag.id, tag]));
      this.selectedTags.set(
        state.tagIds.map((id) => {
          const existing = previousTags.get(id);
          if (existing) {
            return existing;
          }

          return {
            id,
            name: id,
            description: null,
            aliases: [],
          } satisfies SceneTagOption;
        }),
      );
      this.tagSelectedIds.set(state.tagIds);
    }

    this.rebuildTagSelectOptions(this.tagOptions());
    return true;
  }

  private syncUrlWithCurrentFilters(replaceUrl: boolean): void {
    const next = {
      sort:
        this.sceneSort() === PerformerPageComponent.DEFAULT_SORT
          ? null
          : this.sceneSort(),
      favStudios: this.onlyFavoriteStudios() ? '1' : null,
      studios: this.selectedStudiosIds().length > 0 ? this.selectedStudiosIds().join(',') : null,
      tags: this.selectedTags().length > 0 ? this.selectedTags().map((tag) => tag.id).join(',') : null,
    };

    const current = this.route.snapshot.queryParamMap;
    if (
      (current.get('sort') ?? null) === next.sort &&
      (current.get('favStudios') ?? null) === next.favStudios &&
      (current.get('studios') ?? null) === next.studios &&
      (current.get('tags') ?? null) === next.tags
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
        debounceTime(PerformerPageComponent.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query) {
            this.tagOptions.set([]);
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
    if (returnTo.startsWith('/discover')) {
      return 'Back to Discover';
    }
    if (returnTo.startsWith('/scenes')) {
      return 'Back to Scenes';
    }
    if (returnTo.startsWith('/requests')) {
      return 'Back to Requests';
    }
    if (returnTo.startsWith('/performers')) {
      return 'Back to Performers';
    }
    if (returnTo.startsWith('/performer/')) {
      return 'Back to Performer';
    }
    if (returnTo.startsWith('/scene/')) {
      return 'Back to Scene';
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
