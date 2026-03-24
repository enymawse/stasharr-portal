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
import { Router, RouterLink } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Subscription, catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { HomeService } from '../../core/api/home.service';
import { HomeRailConfig, HomeRailKey } from '../../core/api/home.types';
import { DiscoverItem, SceneRequestContext } from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

interface HomeRailView extends HomeRailConfig {
  items: DiscoverItem[];
  error: string | null;
  seeAllQueryParams: Record<string, string>;
}

interface RailLoadResult {
  key: HomeRailKey;
  items: DiscoverItem[];
  error: string | null;
}

interface RailContentState {
  itemsByKey: Partial<Record<HomeRailKey, DiscoverItem[]>>;
  errorsByKey: Partial<Record<HomeRailKey, string>>;
}

@Component({
  selector: 'app-home-page',
  imports: [
    RouterLink,
    ProgressSpinner,
    SceneStatusBadgeComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
})
export class HomePageComponent implements OnInit, OnDestroy {
  private static readonly RAIL_SIZE = 16;

  private readonly discoverService = inject(DiscoverService);
  private readonly homeService = inject(HomeService);
  private readonly router = inject(Router);
  private loadSubscription: Subscription | null = null;
  private saveSubscription: Subscription | null = null;

  @ViewChildren('railViewport')
  private railViewports?: QueryList<ElementRef<HTMLDivElement>>;

  protected readonly loading = signal(false);
  protected readonly configError = signal<string | null>(null);
  protected readonly savingRails = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly railConfigs = signal<HomeRailConfig[]>([]);
  protected readonly editorOpen = signal(false);
  protected readonly draftRails = signal<HomeRailConfig[]>([]);
  protected readonly railItemsByKey = signal<Partial<Record<HomeRailKey, DiscoverItem[]>>>({});
  protected readonly railErrorsByKey = signal<Partial<Record<HomeRailKey, string>>>({});
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);

  ngOnInit(): void {
    this.loadHome();
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
    this.saveSubscription?.unsubscribe();
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
          this.railItemsByKey.set({});
          this.railErrorsByKey.set({});
          return this.loadRailContent(rails);
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: (content) => {
          this.railItemsByKey.set(content.itemsByKey);
          this.railErrorsByKey.set(content.errorsByKey);
        },
        error: () => {
          this.configError.set('Unable to load Home rail configuration right now.');
          this.railConfigs.set([]);
          this.draftRails.set([]);
        },
      });
  }

  protected openEditor(): void {
    this.draftRails.set(this.cloneRails(this.railConfigs()));
    this.saveError.set(null);
    this.editorOpen.set(true);
  }

  protected cancelEditor(): void {
    this.draftRails.set(this.cloneRails(this.railConfigs()));
    this.saveError.set(null);
    this.editorOpen.set(false);
  }

  protected setDraftRailEnabled(railKey: HomeRailKey, enabled: boolean): void {
    this.draftRails.update((rails) =>
      rails.map((rail) => (rail.key === railKey ? { ...rail, enabled } : rail)),
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
    return direction === 'up'
      ? index > 0
      : index < this.draftRails().length - 1;
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
        rail.key !== persistedRail.key ||
        rail.enabled !== persistedRail.enabled ||
        rail.sortOrder !== persistedRail.sortOrder
      );
    });
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
          key: rail.key,
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
          this.railItemsByKey.set(content.itemsByKey);
          this.railErrorsByKey.set(content.errorsByKey);
          this.editorOpen.set(false);
        },
        error: () => {
          this.saveError.set('Unable to save Home rails right now.');
        },
      });
  }

  protected rails(): HomeRailView[] {
    return this.railConfigs()
      .filter((rail) => rail.enabled)
      .map((rail) => ({
        ...rail,
        items: this.railItemsByKey()[rail.key] ?? [],
        error: this.railErrorsByKey()[rail.key] ?? null,
        seeAllQueryParams: {
          fav: rail.favorites,
          sort: 'DATE',
          dir: 'DESC',
        },
      }));
  }

  protected totalLoadedScenes(): number {
    return Object.values(this.railItemsByKey()).reduce(
      (total, items) => total + (items?.length ?? 0),
      0,
    );
  }

  protected activeRailCount(): number {
    return this.railConfigs().filter((rail) => rail.enabled).length;
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

    return enabledRails.every(
      (rail) => rail.items.length === 0 && rail.error === null,
    );
  }

  protected showRail(rail: HomeRailView): boolean {
    return rail.items.length > 0 || rail.error !== null;
  }

  protected railImageUrl(item: DiscoverItem): string | null {
    return item.cardImageUrl ?? item.imageUrl;
  }

  protected currentRouteUrl(): string {
    return this.router.url;
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
    this.railItemsByKey.update((current) => {
      const next: Partial<Record<HomeRailKey, DiscoverItem[]>> = { ...current };
      for (const [key, items] of Object.entries(current) as Array<
        [HomeRailKey, DiscoverItem[] | undefined]
      >) {
        next[key] = (items ?? []).map((item) =>
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

  protected scrollRail(railKey: HomeRailKey, direction: 'prev' | 'next'): void {
    const viewport = this.findRailViewport(railKey);
    if (!viewport) {
      return;
    }

    const delta = Math.max(viewport.clientWidth * 0.82, 320);
    viewport.scrollBy({
      left: direction === 'next' ? delta : -delta,
      behavior: 'smooth',
    });
  }

  private loadRailContent(rails: HomeRailConfig[]) {
    const enabledRails = rails.filter((rail) => rail.enabled);
    if (enabledRails.length === 0) {
      return of<RailContentState>({
        itemsByKey: {},
        errorsByKey: {},
      });
    }

    return forkJoin(
      enabledRails.map((rail) =>
        this.discoverService
          .getScenesFeed(
            1,
            HomePageComponent.RAIL_SIZE,
            'DATE',
            'DESC',
            undefined,
            undefined,
            rail.favorites,
          )
          .pipe(
            map(
              (response): RailLoadResult => ({
                key: rail.key,
                items: response.items,
                error: null,
              }),
            ),
            catchError(() =>
              of<RailLoadResult>({
                key: rail.key,
                items: [],
                error: this.railLoadErrorMessage(rail),
              }),
            ),
          ),
      ),
    ).pipe(
      map((results) => {
        const itemsByKey: Partial<Record<HomeRailKey, DiscoverItem[]>> = {};
        const errorsByKey: Partial<Record<HomeRailKey, string>> = {};

        for (const result of results) {
          itemsByKey[result.key] = result.items;
          if (result.error) {
            errorsByKey[result.key] = result.error;
          }
        }

        return {
          itemsByKey,
          errorsByKey,
        };
      }),
    );
  }

  private railLoadErrorMessage(rail: HomeRailConfig): string {
    return `Unable to load ${rail.title.toLowerCase()} right now.`;
  }

  private sortRails(rails: HomeRailConfig[]): HomeRailConfig[] {
    return [...rails].sort((left, right) => left.sortOrder - right.sortOrder);
  }

  private cloneRails(rails: HomeRailConfig[]): HomeRailConfig[] {
    return rails.map((rail) => ({ ...rail }));
  }

  private findRailViewport(railKey: HomeRailKey): HTMLDivElement | null {
    return (
      this.railViewports?.find(
        (elementRef) => elementRef.nativeElement.dataset['railKey'] === railKey,
      )?.nativeElement ?? null
    );
  }
}
