import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MultiSelect } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import {
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  forkJoin,
  map,
  of,
  switchMap,
} from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import {
  PerformerStudioOption,
  SceneFavoritesFilter,
  SceneFeedSort,
  SceneRequestContext,
  SceneTagMatchMode,
  SceneTagOption,
  SortDirection,
} from '../../core/api/discover.types';
import { HomeService } from '../../core/api/home.service';
import {
  HomeRailContentResponse,
  HomeRailConfig,
  HomeRailFormDraft,
  HomeHybridLibraryAvailability,
  HomeHybridSceneRailConfig,
  HomeRailItem,
  HomeRailSource,
  HomeStashSceneSort,
  HomeStashSceneRailConfig,
  HomeStashdbSceneRailConfig,
  HomeRailViewSummary,
  SaveHomeRailPayload,
} from '../../core/api/home.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

type HomeRailView = HomeRailConfig & {
  items: HomeRailItem[];
  error: string | null;
  seeAllQueryParams: Record<string, string> | null;
  summary: HomeRailViewSummary;
};

interface RailLoadResult {
  id: string;
  items: HomeRailItem[];
  error: string | null;
}

interface RailContentState {
  itemsById: Record<string, HomeRailItem[]>;
  errorsById: Record<string, string>;
}

interface MultiSelectOption {
  label: string;
  value: string;
}

interface MultiSelectGroup {
  label: string;
  items: MultiSelectOption[];
}

type RailFavoritesOption = SceneFavoritesFilter | 'NONE';

@Component({
  selector: 'app-home-page',
  imports: [
    RouterLink,
    FormsModule,
    MultiSelect,
    ProgressSpinner,
    Select,
    SceneStatusBadgeComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent implements OnInit, OnDestroy {
  private static readonly SEARCH_DEBOUNCE_MS = 250;
  private static readonly DEFAULT_LIMIT = 16;
  private static readonly LIMIT_MIN = 6;
  private static readonly LIMIT_MAX = 30;
  private static readonly DEFAULT_SORT: SceneFeedSort = 'DATE';
  private static readonly DEFAULT_DIRECTION: SortDirection = 'DESC';
  private static readonly DEFAULT_TAG_MODE: SceneTagMatchMode = 'OR';
  private static readonly DEFAULT_LIBRARY_AVAILABILITY: HomeHybridLibraryAvailability =
    'MISSING_FROM_LIBRARY';

  protected static readonly SORT_OPTIONS: Array<{ value: SceneFeedSort; label: string }> = [
    { value: 'DATE', label: 'Release Date' },
    { value: 'TITLE', label: 'Title' },
    { value: 'TRENDING', label: 'Trending' },
    { value: 'CREATED_AT', label: 'Created At' },
    { value: 'UPDATED_AT', label: 'Updated At' },
  ];
  protected static readonly STASH_SORT_OPTIONS: Array<{
    value: HomeStashSceneSort;
    label: string;
  }> = [
    { value: 'CREATED_AT', label: 'Recently Added' },
    { value: 'UPDATED_AT', label: 'Recently Updated' },
    { value: 'TITLE', label: 'Title' },
  ];
  protected static readonly SOURCE_OPTIONS: Array<{ value: HomeRailSource; label: string }> = [
    { value: 'STASHDB', label: 'StashDB' },
    { value: 'STASH', label: 'Stash' },
    { value: 'HYBRID', label: 'Hybrid' },
  ];
  protected static readonly DIRECTION_OPTIONS: Array<{
    value: SortDirection;
    label: string;
  }> = [
    { value: 'DESC', label: 'Newest First' },
    { value: 'ASC', label: 'Oldest First' },
  ];
  protected static readonly FAVORITES_OPTIONS: Array<{
    value: RailFavoritesOption;
    label: string;
  }> = [
    { value: 'NONE', label: 'No Favorites Filter' },
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
  protected static readonly HYBRID_LIBRARY_AVAILABILITY_OPTIONS: Array<{
    value: HomeHybridLibraryAvailability;
    label: string;
  }> = [
    { value: 'MISSING_FROM_LIBRARY', label: 'Missing From Library' },
    { value: 'IN_LIBRARY', label: 'Already In Library' },
  ];

  private readonly discoverService = inject(DiscoverService);
  private readonly homeService = inject(HomeService);
  private readonly router = inject(Router);
  private readonly tagSearchTerms = new Subject<string>();
  private readonly studioSearchTerms = new Subject<string>();
  private loadSubscription: Subscription | null = null;
  private saveSubscription: Subscription | null = null;
  private tagSearchSubscription: Subscription | null = null;
  private studioSearchSubscription: Subscription | null = null;
  private railFormMutationSubscription: Subscription | null = null;
  private railDeleteSubscription: Subscription | null = null;

  @ViewChildren('railViewport')
  private railViewports?: QueryList<ElementRef<HTMLDivElement>>;

  protected readonly loading = signal(false);
  protected readonly configError = signal<string | null>(null);
  protected readonly savingRails = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly railConfigs = signal<HomeRailConfig[]>([]);
  protected readonly draftRails = signal<HomeRailConfig[]>([]);
  protected readonly editorOpen = signal(false);

  protected readonly railFormOpen = signal(false);
  protected readonly editingRailId = signal<string | null>(null);
  protected readonly railFormSaving = signal(false);
  protected readonly railFormError = signal<string | null>(null);
  protected readonly deletingRailId = signal<string | null>(null);
  protected readonly deleteError = signal<string | null>(null);
  protected readonly railForm = signal<HomeRailFormDraft | null>(null);

  protected readonly tagSearchTerm = signal('');
  protected readonly tagSearchLoading = signal(false);
  protected readonly tagSearchError = signal<string | null>(null);
  protected readonly tagOptions = signal<SceneTagOption[]>([]);
  protected readonly tagSelectOptions = signal<MultiSelectOption[]>([]);
  protected readonly formTagSelectedIdsModel = signal<string[]>([]);

  protected readonly studioSearchTerm = signal('');
  protected readonly studioSearchLoading = signal(false);
  protected readonly studioSearchError = signal<string | null>(null);
  protected readonly studioOptions = signal<PerformerStudioOption[]>([]);
  protected readonly studioSelectOptions = signal<MultiSelectGroup[]>([]);
  protected readonly formStudioSelectedIdsModel = signal<string[]>([]);

  protected readonly railItemsById = signal<Record<string, HomeRailItem[]>>({});
  protected readonly railErrorsById = signal<Record<string, string>>({});
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);

  protected readonly sortOptions = HomePageComponent.SORT_OPTIONS;
  protected readonly stashSortOptions = HomePageComponent.STASH_SORT_OPTIONS;
  protected readonly directionOptions = HomePageComponent.DIRECTION_OPTIONS;
  protected readonly sourceOptions = HomePageComponent.SOURCE_OPTIONS;
  protected readonly favoritesOptions = HomePageComponent.FAVORITES_OPTIONS;
  protected readonly tagMatchOptions = HomePageComponent.TAG_MATCH_OPTIONS;
  protected readonly hybridLibraryAvailabilityOptions =
    HomePageComponent.HYBRID_LIBRARY_AVAILABILITY_OPTIONS;

  ngOnInit(): void {
    this.setupTagSearch();
    this.setupStudioSearch();
    this.loadHome();
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
    this.saveSubscription?.unsubscribe();
    this.tagSearchSubscription?.unsubscribe();
    this.studioSearchSubscription?.unsubscribe();
    this.railFormMutationSubscription?.unsubscribe();
    this.railDeleteSubscription?.unsubscribe();
  }

  protected loadHome(): void {
    this.loadSubscription?.unsubscribe();
    this.loading.set(true);
    this.configError.set(null);
    this.saveError.set(null);

    this.loadSubscription = this.homeService
      .getRails()
      .pipe(
        map((rails) => this.sortRails(rails)),
        switchMap((rails) => {
          this.railConfigs.set(rails);
          this.draftRails.set(this.cloneRails(rails));
          this.railItemsById.set({});
          this.railErrorsById.set({});
          return this.loadRailContent(rails);
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (content) => {
          this.railItemsById.set(content.itemsById);
          this.railErrorsById.set(content.errorsById);
        },
        error: () => {
          this.configError.set('Unable to load Home rail configuration right now.');
          this.railConfigs.set([]);
          this.draftRails.set([]);
        },
      });
  }

  protected rails(): HomeRailView[] {
    return this.railConfigs()
      .filter((rail) => rail.enabled)
      .map((rail) => ({
        ...rail,
        items: this.railItemsById()[rail.id] ?? [],
        error: this.railErrorsById()[rail.id] ?? null,
        seeAllQueryParams: this.canSeeAll(rail) ? this.buildSeeAllQueryParams(rail.config) : null,
        summary: this.summarizeRail(rail),
      }));
  }

  protected showRail(rail: HomeRailView): boolean {
    return rail.items.length > 0 || rail.error !== null;
  }

  protected totalLoadedScenes(): number {
    return Object.values(this.railItemsById()).reduce(
      (total, items) => total + (items?.length ?? 0),
      0,
    );
  }

  protected activeRailCount(): number {
    return this.railConfigs().filter((rail) => rail.enabled).length;
  }

  protected customRailCount(): number {
    return this.railConfigs().filter((rail) => rail.kind === 'CUSTOM').length;
  }

  protected isNoRailsEnabledState(): boolean {
    return (
      !this.loading() &&
      !this.configError() &&
      this.railConfigs().length > 0 &&
      this.railConfigs().every((rail) => !rail.enabled)
    );
  }

  protected isPageEmptyState(): boolean {
    const enabledRails = this.rails();
    if (this.loading() || this.configError() || enabledRails.length === 0) {
      return false;
    }

    return enabledRails.every((rail) => rail.items.length === 0 && rail.error === null);
  }

  protected openEditor(): void {
    this.draftRails.set(this.cloneRails(this.railConfigs()));
    this.saveError.set(null);
    this.closeRailForm();
    this.editorOpen.set(true);
  }

  protected cancelEditor(): void {
    this.draftRails.set(this.cloneRails(this.railConfigs()));
    this.saveError.set(null);
    this.deleteError.set(null);
    this.closeRailForm();
    this.editorOpen.set(false);
  }

  protected setDraftRailEnabled(railId: string, enabled: boolean): void {
    this.draftRails.update((rails) =>
      rails.map((rail) => (rail.id === railId ? { ...rail, enabled } : rail)),
    );
  }

  protected moveDraftRail(index: number, direction: 'up' | 'down'): void {
    this.draftRails.update((rails) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= rails.length) {
        return rails;
      }

      const next = [...rails];
      const [movedRail] = next.splice(index, 1);
      next.splice(targetIndex, 0, movedRail);
      return next.map((rail, currentIndex) => ({
        ...rail,
        sortOrder: currentIndex,
      }));
    });
  }

  protected canMoveDraftRail(index: number, direction: 'up' | 'down'): boolean {
    return direction === 'up' ? index > 0 : index < this.draftRails().length - 1;
  }

  protected hasDraftChanges(): boolean {
    const persisted = this.railConfigs();
    const draft = this.draftRails();
    if (persisted.length !== draft.length) {
      return true;
    }

    return draft.some((rail, index) => {
      const persistedRail = persisted[index];
      if (!persistedRail) {
        return true;
      }

      return (
        rail.id !== persistedRail.id ||
        rail.enabled !== persistedRail.enabled ||
        rail.sortOrder !== persistedRail.sortOrder
      );
    });
  }

  protected canMutateCustomRails(): boolean {
    return !this.hasDraftChanges() && !this.savingRails() && !this.railFormSaving();
  }

  protected openCreateRailForm(): void {
    if (!this.canMutateCustomRails()) {
      return;
    }

    this.editingRailId.set(null);
    this.deleteError.set(null);
    this.railFormError.set(null);
    this.railForm.set(this.createEmptyRailForm());
    this.formTagSelectedIdsModel.set([]);
    this.formStudioSelectedIdsModel.set([]);
    this.tagSearchTerm.set('');
    this.studioSearchTerm.set('');
    this.rebuildRailFormTagSelectOptions([]);
    this.rebuildRailFormStudioSelectOptions([]);
    this.railFormOpen.set(true);
  }

  protected openEditRailForm(rail: HomeRailConfig): void {
    if (!rail.editable || !this.canMutateCustomRails()) {
      return;
    }

    this.editingRailId.set(rail.id);
    this.deleteError.set(null);
    this.railFormError.set(null);
    const form = this.buildFormFromRail(rail);
    this.railForm.set(form);
    this.formTagSelectedIdsModel.set(form.selectedTags.map((tag) => tag.id));
    this.formStudioSelectedIdsModel.set(form.selectedStudios.map((studio) => studio.id));
    this.tagSearchTerm.set('');
    this.studioSearchTerm.set('');
    this.rebuildRailFormTagSelectOptions([]);
    this.rebuildRailFormStudioSelectOptions([]);
    this.railFormOpen.set(true);
  }

  protected closeRailForm(): void {
    this.railFormOpen.set(false);
    this.editingRailId.set(null);
    this.railFormError.set(null);
    this.railForm.set(null);
    this.formTagSelectedIdsModel.set([]);
    this.formStudioSelectedIdsModel.set([]);
    this.tagSearchTerm.set('');
    this.studioSearchTerm.set('');
    this.tagOptions.set([]);
    this.tagSelectOptions.set([]);
    this.studioOptions.set([]);
    this.studioSelectOptions.set([]);
    this.tagSearchError.set(null);
    this.studioSearchError.set(null);
  }

  protected saveRails(): void {
    if (this.savingRails() || !this.hasDraftChanges()) {
      return;
    }

    this.saveSubscription?.unsubscribe();
    this.savingRails.set(true);
    this.saveError.set(null);

    const orderedRails = this.draftRails().map((rail, index) => ({
      ...rail,
      sortOrder: index,
    }));

    this.saveSubscription = this.homeService
      .updateRails({
        rails: orderedRails.map((rail) => ({
          id: rail.id,
          enabled: rail.enabled,
        })),
      })
      .pipe(
        map((rails) => this.sortRails(rails)),
        switchMap((rails) => {
          this.railConfigs.set(rails);
          this.draftRails.set(this.cloneRails(rails));
          return this.loadRailContent(rails).pipe(map((content) => ({ rails, content })));
        }),
        finalize(() => this.savingRails.set(false)),
      )
      .subscribe({
        next: ({ content }) => {
          this.railItemsById.set(content.itemsById);
          this.railErrorsById.set(content.errorsById);
          this.editorOpen.set(false);
        },
        error: () => {
          this.saveError.set('Unable to save Home rails right now.');
        },
      });
  }

  protected saveRailForm(): void {
    const form = this.railForm();
    if (!form || this.railFormSaving()) {
      return;
    }

    const payload = this.buildRailPayload(form);
    if (!payload.title.trim()) {
      this.railFormError.set('A title is required for custom Home rails.');
      return;
    }

    this.railFormMutationSubscription?.unsubscribe();
    this.railFormSaving.set(true);
    this.railFormError.set(null);

    const request$ = this.editingRailId()
      ? this.homeService.updateRail(this.editingRailId() as string, payload)
      : this.homeService.createRail(payload);

    this.railFormMutationSubscription = request$
      .pipe(finalize(() => this.railFormSaving.set(false)))
      .subscribe({
        next: () => {
          this.closeRailForm();
          this.editorOpen.set(true);
          this.loadHome();
        },
        error: () => {
          this.railFormError.set('Unable to save this Home rail right now.');
        },
      });
  }

  protected deleteCustomRail(rail: HomeRailConfig): void {
    if (!rail.deletable || !this.canMutateCustomRails()) {
      return;
    }

    if (!window.confirm(`Delete the Home rail "${rail.title}"?`)) {
      return;
    }

    this.railDeleteSubscription?.unsubscribe();
    this.deletingRailId.set(rail.id);
    this.deleteError.set(null);

    this.railDeleteSubscription = this.homeService
      .deleteRail(rail.id)
      .pipe(finalize(() => this.deletingRailId.set(null)))
      .subscribe({
        next: () => {
          if (this.editingRailId() === rail.id) {
            this.closeRailForm();
          }
          this.editorOpen.set(true);
          this.loadHome();
        },
        error: () => {
          this.deleteError.set('Unable to delete this Home rail right now.');
        },
      });
  }

  protected isDeletingRail(railId: string): boolean {
    return this.deletingRailId() === railId;
  }

  protected updateRailForm<K extends keyof Pick<
    HomeRailFormDraft,
    | 'source'
    | 'title'
    | 'subtitle'
    | 'enabled'
    | 'sort'
    | 'direction'
    | 'titleQuery'
    | 'favorites'
    | 'stashdbFavorites'
    | 'tagMode'
    | 'favoritePerformersOnly'
    | 'favoriteStudiosOnly'
    | 'favoriteTagsOnly'
    | 'stashFavoritePerformersOnly'
    | 'stashFavoriteStudiosOnly'
    | 'stashFavoriteTagsOnly'
    | 'libraryAvailability'
    | 'limit'
  >>(field: K, value: HomeRailFormDraft[K]): void {
    this.railForm.update((current) => {
      if (!current) {
        return current;
      }

      const next = { ...current, [field]: value };
      if (
        field === 'libraryAvailability' &&
        value === 'MISSING_FROM_LIBRARY' &&
        next.source === 'HYBRID'
      ) {
        next.stashFavoritePerformersOnly = false;
        next.stashFavoriteStudiosOnly = false;
        next.stashFavoriteTagsOnly = false;
      }

      return next;
    });
  }

  protected updateRailSource(nextSource: HomeRailSource): void {
    this.railForm.update((current) => {
      if (!current) {
        return current;
      }

      if (current.source === nextSource) {
        return current;
      }

      if (nextSource === 'STASH') {
        return {
          ...current,
          source: 'STASH',
          sort: 'CREATED_AT',
          titleQuery: '',
          favorites: 'NONE',
          stashdbFavorites: 'NONE',
          tagMode: HomePageComponent.DEFAULT_TAG_MODE,
          favoritePerformersOnly: false,
          favoriteStudiosOnly: false,
          favoriteTagsOnly:
            current.source === 'HYBRID' ? current.stashFavoriteTagsOnly : false,
          stashFavoritePerformersOnly:
            current.source === 'HYBRID' ? current.stashFavoritePerformersOnly : false,
          stashFavoriteStudiosOnly:
            current.source === 'HYBRID' ? current.stashFavoriteStudiosOnly : false,
          stashFavoriteTagsOnly: false,
          libraryAvailability: HomePageComponent.DEFAULT_LIBRARY_AVAILABILITY,
          selectedTags: [],
          selectedStudios: [],
        };
      }

      if (nextSource === 'HYBRID') {
        return {
          ...current,
          source: 'HYBRID',
          sort: 'DATE',
          titleQuery: '',
          favorites: 'NONE',
          stashdbFavorites:
            current.source === 'STASHDB'
              ? current.favorites
              : current.source === 'HYBRID'
                ? current.stashdbFavorites
                : 'NONE',
          tagMode: current.tagMode,
          favoritePerformersOnly: false,
          favoriteStudiosOnly: false,
          favoriteTagsOnly: false,
          stashFavoritePerformersOnly: false,
          stashFavoriteStudiosOnly: false,
          stashFavoriteTagsOnly: false,
          libraryAvailability: HomePageComponent.DEFAULT_LIBRARY_AVAILABILITY,
          selectedTags: current.source === 'STASH' ? [] : current.selectedTags,
          selectedStudios: current.source === 'STASH' ? [] : current.selectedStudios,
        };
      }

      return {
        ...current,
        source: 'STASHDB',
        sort: 'DATE',
        titleQuery: '',
        favorites: current.source === 'HYBRID' ? current.stashdbFavorites : current.favorites,
        stashdbFavorites: 'NONE',
        favoritePerformersOnly: false,
        favoriteStudiosOnly: false,
        favoriteTagsOnly: false,
        stashFavoritePerformersOnly: false,
        stashFavoriteStudiosOnly: false,
        stashFavoriteTagsOnly: false,
        libraryAvailability: HomePageComponent.DEFAULT_LIBRARY_AVAILABILITY,
        selectedTags: current.source === 'STASH' ? [] : current.selectedTags,
        selectedStudios: current.source === 'STASH' ? [] : current.selectedStudios,
      };
    });
    const updatedForm = this.railForm();
    this.formTagSelectedIdsModel.set(updatedForm?.selectedTags.map((tag) => tag.id) ?? []);
    this.formStudioSelectedIdsModel.set(
      updatedForm?.selectedStudios.map((studio) => studio.id) ?? [],
    );
    this.rebuildRailFormTagSelectOptions(this.tagOptions());
    this.rebuildRailFormStudioSelectOptions(this.studioOptions());
  }

  protected onRailFormTagSelectionChanged(nextValue: string[] | null): void {
    const nextIds = this.dedupeStrings(nextValue ?? []);
    this.formTagSelectedIdsModel.set(nextIds);

    const previousTags = new Map((this.railForm()?.selectedTags ?? []).map((tag) => [tag.id, tag]));
    const currentTags = new Map(this.tagOptions().map((tag) => [tag.id, tag]));
    const nextSelected = nextIds
      .map((id) => currentTags.get(id) ?? previousTags.get(id))
      .filter((tag): tag is SceneTagOption => Boolean(tag));

    this.railForm.update((current) =>
      current
        ? {
            ...current,
            selectedTags: nextSelected,
          }
        : current,
    );
    this.rebuildRailFormTagSelectOptions(this.tagOptions());
  }

  protected onRailFormStudioSelectionChanged(nextValue: string[] | null): void {
    const nextIds = this.dedupeStrings(nextValue ?? []);
    this.formStudioSelectedIdsModel.set(nextIds);

    const previousLabels = new Map(
      (this.railForm()?.selectedStudios ?? []).map((studio) => [studio.id, studio.label]),
    );
    const currentLabels = this.studioLabelMap();
    const nextSelected = nextIds.map((id) => ({
      id,
      label: currentLabels.get(id) ?? previousLabels.get(id) ?? id,
    }));

    this.railForm.update((current) =>
      current
        ? {
            ...current,
            selectedStudios: nextSelected,
          }
        : current,
    );
    this.rebuildRailFormStudioSelectOptions(this.studioOptions());
  }

  protected onRailFormTagFilterChanged(nextValue: string | null | undefined): void {
    const nextTerm = (nextValue ?? '').trimStart();
    this.tagSearchTerm.set(nextTerm);
    this.tagSearchTerms.next(nextTerm);
  }

  protected onRailFormStudioFilterChanged(nextValue: string | null | undefined): void {
    const nextTerm = (nextValue ?? '').trimStart();
    this.studioSearchTerm.set(nextTerm);
    this.studioSearchTerms.next(nextTerm);
  }

  protected onRailFormTagPanelHide(): void {
    this.onRailFormTagFilterChanged('');
  }

  protected onRailFormStudioPanelHide(): void {
    this.onRailFormStudioFilterChanged('');
  }

  protected tagSelectEmptyMessage(): string {
    if (this.tagSearchError()) {
      return this.tagSearchError() ?? 'Failed to load tag options.';
    }

    if (this.tagSearchTerm().trim().length === 0) {
      return this.isStashForm() ? 'Type to search local tags.' : 'Type to search tags.';
    }

    return 'No matching tags.';
  }

  protected studioSelectEmptyMessage(): string {
    if (this.studioSearchError()) {
      return this.studioSearchError() ?? 'Failed to load studio options.';
    }

    if (this.studioSearchTerm().trim().length === 0) {
      return this.isStashForm()
        ? 'Type to search local studios.'
        : 'Type to search studio networks.';
    }

    return 'No matching studios.';
  }

  protected railImageUrl(item: HomeRailItem): string | null {
    return item.cardImageUrl ?? item.imageUrl;
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  protected isRequestable(item: HomeRailItem): boolean {
    return item.requestable && item.status.state === 'NOT_REQUESTED';
  }

  protected openRequestModal(item: HomeRailItem): void {
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
    this.railItemsById.update((current) => {
      const next: Record<string, HomeRailItem[]> = { ...current };
      for (const [railId, items] of Object.entries(current)) {
        next[railId] = items.map((item) =>
          item.id === stashId
            ? {
                ...item,
                status: { state: 'DOWNLOADING' },
              }
            : item,
        );
      }
      return next;
    });
  }

  protected scrollRail(railId: string, direction: 'prev' | 'next'): void {
    const viewport = this.findRailViewport(railId);
    if (!viewport) {
      return;
    }

    const delta = Math.max(viewport.clientWidth * 0.82, 320);
    viewport.scrollBy({
      left: direction === 'next' ? delta : -delta,
      behavior: 'smooth',
    });
  }

  protected kindLabel(rail: HomeRailConfig): string {
    return rail.kind === 'BUILTIN' ? 'Built-in' : 'Custom';
  }

  protected sourceLabel(source: HomeRailSource): string {
    if (source === 'STASH') {
      return 'Stash';
    }
    if (source === 'HYBRID') {
      return 'Hybrid';
    }

    return 'StashDB';
  }

  protected isStashRail(rail: HomeRailConfig): rail is Extract<HomeRailConfig, { source: 'STASH' }> {
    return rail.source === 'STASH';
  }

  protected isHybridRail(
    rail: HomeRailConfig,
  ): rail is Extract<HomeRailConfig, { source: 'HYBRID' }> {
    return rail.source === 'HYBRID';
  }

  protected isStashForm(): boolean {
    return this.railForm()?.source === 'STASH';
  }

  protected isHybridForm(): boolean {
    return this.railForm()?.source === 'HYBRID';
  }

  protected showHybridLocalFavoritesControls(): boolean {
    const form = this.railForm();
    return form?.source === 'HYBRID' && form.libraryAvailability === 'IN_LIBRARY';
  }

  protected railFormSortOptions() {
    return this.isStashForm() ? this.stashSortOptions : this.sortOptions;
  }

  protected railFavoritesValue(rail: HomeRailConfig): string | null {
    const config = rail.config;

    if (this.isStashdbConfig(config)) {
      return (
        HomePageComponent.FAVORITES_OPTIONS.find(
          (option) => option.value === (config.favorites ?? 'NONE'),
        )?.label ?? 'No Favorites Filter'
      );
    }
    if (this.isHybridConfig(config)) {
      return this.hybridFavoritesSummary(config);
    }

    return this.stashFavoriteSummary(config);
  }

  protected railLocalFavoritesValue(rail: HomeRailConfig): string | null {
    return this.stashLocalFavoritesLabelForRail(rail);
  }

  protected railTagCount(rail: HomeRailConfig): number {
    return rail.config.tagIds.length;
  }

  protected railStudioCount(rail: HomeRailConfig): number {
    return rail.config.studioIds.length;
  }

  protected canSeeAll(rail: HomeRailConfig): boolean {
    return rail.source === 'STASHDB';
  }

  protected isInternalSceneRoute(item: HomeRailItem): boolean {
    return item.source === 'STASHDB';
  }

  private loadRailContent(rails: HomeRailConfig[]) {
    const enabledRails = rails.filter((rail) => rail.enabled);
    if (enabledRails.length === 0) {
      return of<RailContentState>({
        itemsById: {},
        errorsById: {},
      });
    }

    return forkJoin(
      enabledRails.map((rail) =>
        this.loadSingleRail(rail)
          .pipe(
            map((response): RailLoadResult => response),
            catchError(() =>
              of<RailLoadResult>({
                id: rail.id,
                items: [],
                error: this.railLoadErrorMessage(rail),
              }),
            ),
          ),
      ),
    ).pipe(
      map((results) => {
        const itemsById: Record<string, HomeRailItem[]> = {};
        const errorsById: Record<string, string> = {};

        for (const result of results) {
          itemsById[result.id] = result.items;
          if (result.error) {
            errorsById[result.id] = result.error;
          }
        }

        return {
          itemsById,
          errorsById,
        } satisfies RailContentState;
      }),
    );
  }

  private railLoadErrorMessage(rail: HomeRailConfig): string {
    return `Unable to load ${rail.title.toLowerCase()} right now.`;
  }

  private loadSingleRail(rail: HomeRailConfig) {
    if (rail.source === 'STASH' || rail.source === 'HYBRID') {
      return this.homeService.getRailItems(rail.id).pipe(
        map(
          (response: HomeRailContentResponse): RailLoadResult => ({
            id: rail.id,
            items: response.items,
            error: response.message,
          }),
        ),
      );
    }

    return this.discoverService
      .getScenesFeed(
        1,
        rail.config.limit,
        rail.config.sort,
        rail.config.direction,
        rail.config.tagIds,
        rail.config.tagIds.length > 0 ? rail.config.tagMode ?? 'OR' : undefined,
        rail.config.favorites ?? undefined,
        rail.config.studioIds,
      )
      .pipe(
        map(
          (response): RailLoadResult => ({
            id: rail.id,
            items: response.items.map((item) => ({
              ...item,
              requestable: item.status.state === 'NOT_REQUESTED',
              viewUrl: null,
            })),
            error: null,
          }),
        ),
      );
  }

  private buildSeeAllQueryParams(config: HomeRailConfig['config']): Record<string, string> {
    const params: Record<string, string> = {
      sort: config.sort,
      dir: config.direction,
    };

    if ('favorites' in config && config.favorites) {
      params['fav'] = config.favorites;
    }
    if ('tagIds' in config && config.tagIds.length > 0) {
      params['tags'] = config.tagIds.join(',');
      params['tagNames'] = config.tagNames.join(',');
      params['mode'] = config.tagMode ?? 'OR';
    }
    if ('studioIds' in config && config.studioIds.length > 0) {
      params['studios'] = config.studioIds.join(',');
      params['studioNames'] = config.studioNames.join(',');
    }

    return params;
  }

  private summarizeRail(rail: HomeRailConfig): HomeRailViewSummary {
    return {
      sortLabel: this.sortLabelForRail(rail),
      favoritesLabel: this.favoritesLabelForRail(rail),
      stashLocalFavoritesLabel: this.stashLocalFavoritesLabelForRail(rail),
      titleQueryLabel: this.titleQueryLabelForRail(rail),
      libraryAvailabilityLabel: this.libraryAvailabilityLabelForRail(rail),
      tagCount: rail.config.tagIds.length,
      studioCount: rail.config.studioIds.length,
      limit: rail.config.limit,
    };
  }

  private sortRails(rails: HomeRailConfig[]): HomeRailConfig[] {
    return [...rails].sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private cloneRails(rails: HomeRailConfig[]): HomeRailConfig[] {
    return rails.map((rail): HomeRailConfig => {
      switch (rail.source) {
        case 'STASHDB':
          return {
            ...rail,
            config: {
              ...rail.config,
              tagIds: [...rail.config.tagIds],
              tagNames: [...rail.config.tagNames],
              studioIds: [...rail.config.studioIds],
              studioNames: [...rail.config.studioNames],
            },
          };
        case 'HYBRID':
          return {
            ...rail,
            config: {
              ...rail.config,
              tagIds: [...rail.config.tagIds],
              tagNames: [...rail.config.tagNames],
              studioIds: [...rail.config.studioIds],
              studioNames: [...rail.config.studioNames],
            },
          };
        case 'STASH':
          return {
            ...rail,
            config: {
              ...rail.config,
              tagIds: [...rail.config.tagIds],
              tagNames: [...rail.config.tagNames],
              studioIds: [...rail.config.studioIds],
              studioNames: [...rail.config.studioNames],
            },
          };
      }
    });
  }

  private buildFormFromRail(rail: HomeRailConfig): HomeRailFormDraft {
    const config = rail.config;
    return {
      title: rail.title,
      subtitle: rail.subtitle ?? '',
      enabled: rail.enabled,
      source: rail.source,
      sort: config.sort,
      direction: config.direction,
      titleQuery: this.isStashConfig(config) ? config.titleQuery ?? '' : '',
      favorites: this.isStashdbConfig(config) ? config.favorites ?? 'NONE' : 'NONE',
      stashdbFavorites: this.isHybridConfig(config) ? config.stashdbFavorites ?? 'NONE' : 'NONE',
      tagMode: config.tagMode ?? HomePageComponent.DEFAULT_TAG_MODE,
      favoritePerformersOnly:
        this.isStashConfig(config) ? config.favoritePerformersOnly : false,
      favoriteStudiosOnly: this.isStashConfig(config) ? config.favoriteStudiosOnly : false,
      favoriteTagsOnly: this.isStashConfig(config) ? config.favoriteTagsOnly : false,
      stashFavoritePerformersOnly:
        this.isHybridConfig(config) ? config.stashFavoritePerformersOnly : false,
      stashFavoriteStudiosOnly:
        this.isHybridConfig(config) ? config.stashFavoriteStudiosOnly : false,
      stashFavoriteTagsOnly:
        this.isHybridConfig(config) ? config.stashFavoriteTagsOnly : false,
      libraryAvailability: this.isHybridConfig(config)
        ? config.libraryAvailability
        : HomePageComponent.DEFAULT_LIBRARY_AVAILABILITY,
      limit: config.limit,
      selectedTags: config.tagIds
        ? config.tagIds.map((id, index) => ({
              id,
              name: config.tagNames[index] ?? id,
              description: null,
              aliases: [],
            }))
          : [],
      selectedStudios: config.studioIds
        ? config.studioIds.map((id, index) => ({
              id,
              label: config.studioNames[index] ?? id,
            }))
          : [],
    };
  }

  private createEmptyRailForm(): HomeRailFormDraft {
    return {
      title: '',
      subtitle: '',
      enabled: true,
      source: 'STASHDB',
      sort: HomePageComponent.DEFAULT_SORT,
      direction: HomePageComponent.DEFAULT_DIRECTION,
      titleQuery: '',
      favorites: 'NONE',
      stashdbFavorites: 'NONE',
      tagMode: HomePageComponent.DEFAULT_TAG_MODE,
      favoritePerformersOnly: false,
      favoriteStudiosOnly: false,
      favoriteTagsOnly: false,
      stashFavoritePerformersOnly: false,
      stashFavoriteStudiosOnly: false,
      stashFavoriteTagsOnly: false,
      libraryAvailability: HomePageComponent.DEFAULT_LIBRARY_AVAILABILITY,
      limit: HomePageComponent.DEFAULT_LIMIT,
      selectedTags: [],
      selectedStudios: [],
    };
  }

  private buildRailPayload(form: HomeRailFormDraft): SaveHomeRailPayload {
    if (form.source === 'STASH') {
      return {
        source: 'STASH',
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        enabled: form.enabled,
        config: {
          sort: form.sort as HomeStashSceneSort,
          direction: form.direction,
          titleQuery: form.titleQuery.trim() || null,
          tagIds: form.selectedTags.map((tag) => tag.id),
          tagNames: form.selectedTags.map((tag) => tag.name),
          tagMode: form.selectedTags.length > 0 ? form.tagMode : null,
          studioIds: form.selectedStudios.map((studio) => studio.id),
          studioNames: form.selectedStudios.map((studio) => studio.label),
          favoritePerformersOnly: form.favoritePerformersOnly,
          favoriteStudiosOnly: form.favoriteStudiosOnly,
          favoriteTagsOnly: form.favoriteTagsOnly,
          limit: Math.min(
            Math.max(
              Math.round(Number(form.limit) || HomePageComponent.DEFAULT_LIMIT),
              HomePageComponent.LIMIT_MIN,
            ),
            HomePageComponent.LIMIT_MAX,
          ),
        },
      };
    }

    if (form.source === 'HYBRID') {
      const usesStashLocalFavoriteOverlays = form.libraryAvailability === 'IN_LIBRARY';
      return {
        source: 'HYBRID',
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        enabled: form.enabled,
        config: {
          sort: form.sort as SceneFeedSort,
          direction: form.direction,
          stashdbFavorites: form.stashdbFavorites === 'NONE' ? null : form.stashdbFavorites,
          tagIds: form.selectedTags.map((tag) => tag.id),
          tagNames: form.selectedTags.map((tag) => tag.name),
          tagMode: form.selectedTags.length > 0 ? form.tagMode : null,
          studioIds: form.selectedStudios.map((studio) => studio.id),
          studioNames: form.selectedStudios.map((studio) => studio.label),
          stashFavoritePerformersOnly: usesStashLocalFavoriteOverlays
            ? form.stashFavoritePerformersOnly
            : false,
          stashFavoriteStudiosOnly: usesStashLocalFavoriteOverlays
            ? form.stashFavoriteStudiosOnly
            : false,
          stashFavoriteTagsOnly: usesStashLocalFavoriteOverlays
            ? form.stashFavoriteTagsOnly
            : false,
          libraryAvailability: form.libraryAvailability,
          limit: Math.min(
            Math.max(Math.round(Number(form.limit) || HomePageComponent.DEFAULT_LIMIT), HomePageComponent.LIMIT_MIN),
            HomePageComponent.LIMIT_MAX,
          ),
        },
      };
    }

    return {
      source: 'STASHDB',
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      enabled: form.enabled,
      config: {
        sort: form.sort,
        direction: form.direction,
        favorites: form.favorites === 'NONE' ? null : form.favorites,
        tagIds: form.selectedTags.map((tag) => tag.id),
        tagNames: form.selectedTags.map((tag) => tag.name),
        tagMode:
          form.selectedTags.length > 0 ? form.tagMode : null,
        studioIds: form.selectedStudios.map((studio) => studio.id),
        studioNames: form.selectedStudios.map((studio) => studio.label),
        limit: Math.min(
          Math.max(Math.round(Number(form.limit) || HomePageComponent.DEFAULT_LIMIT), HomePageComponent.LIMIT_MIN),
          HomePageComponent.LIMIT_MAX,
        ),
      },
    };
  }

  private setupTagSearch(): void {
    this.tagSearchSubscription = this.tagSearchTerms
      .pipe(
        map((value) => value.trim()),
        debounceTime(HomePageComponent.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query) {
            this.tagOptions.set([]);
            this.tagSearchError.set(null);
            this.rebuildRailFormTagSelectOptions([]);
            return of<SceneTagOption[]>([]);
          }

          this.tagSearchLoading.set(true);
          this.tagSearchError.set(null);

          return this.searchRailTags(query).pipe(
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
        this.rebuildRailFormTagSelectOptions(options);
      });
  }

  private setupStudioSearch(): void {
    this.studioSearchSubscription = this.studioSearchTerms
      .pipe(
        map((value) => value.trim()),
        debounceTime(HomePageComponent.SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        switchMap((query) => {
          if (!query) {
            this.studioOptions.set([]);
            this.studioSearchError.set(null);
            this.rebuildRailFormStudioSelectOptions([]);
            return of<PerformerStudioOption[]>([]);
          }

          this.studioSearchLoading.set(true);
          this.studioSearchError.set(null);

          return this.searchRailStudios(query).pipe(
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
        this.rebuildRailFormStudioSelectOptions(options);
      });
  }

  private rebuildRailFormTagSelectOptions(searchResults: SceneTagOption[]): void {
    const merged = new Map<string, MultiSelectOption>();

    for (const selected of this.railForm()?.selectedTags ?? []) {
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

  private rebuildRailFormStudioSelectOptions(options: PerformerStudioOption[]): void {
    const selectedLabels = new Map(
      (this.railForm()?.selectedStudios ?? []).map((studio) => [studio.id, studio.label]),
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
    const selectedOnlyItems = (this.railForm()?.selectedStudios ?? [])
      .filter((studio) => !seen.has(studio.id))
      .map((studio) => ({
        label: studio.label,
        value: studio.id,
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

  private findRailViewport(railId: string): HTMLDivElement | null {
    return (
      this.railViewports?.find(
        (elementRef) => elementRef.nativeElement.dataset['railId'] === railId,
      )?.nativeElement ?? null
    );
  }

  private isStashdbConfig(
    config: HomeRailConfig['config'],
  ): config is HomeStashdbSceneRailConfig {
    return 'favorites' in config;
  }

  private isHybridConfig(
    config: HomeRailConfig['config'],
  ): config is HomeHybridSceneRailConfig {
    return 'libraryAvailability' in config;
  }

  private isStashConfig(
    config: HomeRailConfig['config'],
  ): config is HomeStashSceneRailConfig {
    return !this.isStashdbConfig(config) && !this.isHybridConfig(config);
  }

  private favoritesLabelForRail(rail: HomeRailConfig): string {
    const config = rail.config;
    if (this.isHybridConfig(config)) {
      return this.hybridFavoritesSummary(config);
    }
    if (this.isStashConfig(config)) {
      return 'Local Library';
    }

    return (
      HomePageComponent.FAVORITES_OPTIONS.find(
        (option) => option.value === (config.favorites ?? 'NONE'),
      )?.label ?? 'No Favorites Filter'
    );
  }

  private sortLabelForRail(rail: HomeRailConfig): string {
    const options = rail.source === 'STASH' ? this.stashSortOptions : this.sortOptions;
    return options.find((option) => option.value === rail.config.sort)?.label ?? rail.config.sort;
  }

  private titleQueryLabelForRail(rail: HomeRailConfig): string | null {
    if (this.isStashConfig(rail.config) && rail.config.titleQuery) {
      return `Title contains "${rail.config.titleQuery}"`;
    }

    return null;
  }

  private libraryAvailabilityLabelForRail(rail: HomeRailConfig): string | null {
    if (!this.isHybridConfig(rail.config)) {
      return null;
    }

    return rail.config.libraryAvailability === 'IN_LIBRARY'
      ? 'Already In Library'
      : 'Missing From Library';
  }

  private stashFavoriteSummary(config: HomeStashSceneRailConfig): string {
    return (
      this.stashLocalFavoritesSummary(
        config.favoritePerformersOnly,
        config.favoriteStudiosOnly,
        config.favoriteTagsOnly,
      ) ?? 'Local Library'
    );
  }

  private hybridFavoritesSummary(config: HomeHybridSceneRailConfig): string {
    const label =
      HomePageComponent.FAVORITES_OPTIONS.find(
        (option) => option.value === (config.stashdbFavorites ?? 'NONE'),
      )?.label ?? 'No Favorites Filter';

    return `StashDB ${label}`;
  }

  private stashLocalFavoritesLabelForRail(rail: HomeRailConfig): string | null {
    if (this.isStashConfig(rail.config)) {
      return this.stashLocalFavoritesSummary(
        rail.config.favoritePerformersOnly,
        rail.config.favoriteStudiosOnly,
        rail.config.favoriteTagsOnly,
      );
    }

    if (this.isHybridConfig(rail.config)) {
      return this.stashLocalFavoritesSummary(
        rail.config.stashFavoritePerformersOnly,
        rail.config.stashFavoriteStudiosOnly,
        rail.config.stashFavoriteTagsOnly,
      );
    }

    return null;
  }

  private stashLocalFavoritesSummary(
    favoritePerformersOnly: boolean,
    favoriteStudiosOnly: boolean,
    favoriteTagsOnly: boolean,
  ): string | null {
    const labels: string[] = [];
    if (favoritePerformersOnly) {
      labels.push('Favorite Performers');
    }
    if (favoriteStudiosOnly) {
      labels.push('Favorite Studios');
    }
    if (favoriteTagsOnly) {
      labels.push('Favorite Tags');
    }

    return labels.length > 0 ? `Stash Local ${labels.join(' + ')}` : null;
  }

  private searchRailTags(query: string) {
    return this.isStashForm()
      ? this.homeService.searchStashTags(query)
      : this.discoverService.searchSceneTags(query);
  }

  private searchRailStudios(query: string) {
    return this.isStashForm()
      ? this.homeService.searchStashStudios(query)
      : this.discoverService.searchPerformerStudios(query);
  }
}
