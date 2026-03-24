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
import { Subscription, catchError, finalize, forkJoin, map, of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import {
  DiscoverItem,
  SceneFavoritesFilter,
  SceneRequestContext,
} from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

type HomeRailKey = 'favorite-studios' | 'favorite-performers';

interface HomeRailView {
  key: HomeRailKey;
  title: string;
  subtitle: string;
  favorites: Extract<SceneFavoritesFilter, 'STUDIO' | 'PERFORMER'>;
  items: DiscoverItem[];
  error: string | null;
  seeAllQueryParams: Record<string, string>;
}

interface RailLoadResult {
  items: DiscoverItem[];
  error: string | null;
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
  private readonly router = inject(Router);
  private loadSubscription: Subscription | null = null;

  @ViewChildren('railViewport')
  private readonly railViewports?: QueryList<ElementRef<HTMLDivElement>>;

  protected readonly loading = signal(false);
  protected readonly favoriteStudiosItems = signal<DiscoverItem[]>([]);
  protected readonly favoritePerformersItems = signal<DiscoverItem[]>([]);
  protected readonly favoriteStudiosError = signal<string | null>(null);
  protected readonly favoritePerformersError = signal<string | null>(null);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);

  ngOnInit(): void {
    this.loadHome();
  }

  ngOnDestroy(): void {
    this.loadSubscription?.unsubscribe();
  }

  protected loadHome(): void {
    this.loadSubscription?.unsubscribe();
    this.loading.set(true);
    this.favoriteStudiosItems.set([]);
    this.favoritePerformersItems.set([]);
    this.favoriteStudiosError.set(null);
    this.favoritePerformersError.set(null);

    this.loadSubscription = forkJoin({
      favoriteStudios: this.loadRail(
        'STUDIO',
        'Unable to load scenes from favorite studios right now.',
      ),
      favoritePerformers: this.loadRail(
        'PERFORMER',
        'Unable to load scenes from favorite performers right now.',
      ),
    })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe(({ favoriteStudios, favoritePerformers }) => {
        this.favoriteStudiosItems.set(favoriteStudios.items);
        this.favoriteStudiosError.set(favoriteStudios.error);
        this.favoritePerformersItems.set(favoritePerformers.items);
        this.favoritePerformersError.set(favoritePerformers.error);
      });
  }

  protected rails(): HomeRailView[] {
    return [
      {
        key: 'favorite-studios',
        title: 'Latest From Favorite Studios',
        subtitle: 'Recent scenes pulled from the studios you have starred.',
        favorites: 'STUDIO',
        items: this.favoriteStudiosItems(),
        error: this.favoriteStudiosError(),
        seeAllQueryParams: {
          fav: 'STUDIO',
          sort: 'DATE',
          dir: 'DESC',
        },
      },
      {
        key: 'favorite-performers',
        title: 'Latest From Favorite Performers',
        subtitle: 'A rolling lineup from performers you are actively tracking.',
        favorites: 'PERFORMER',
        items: this.favoritePerformersItems(),
        error: this.favoritePerformersError(),
        seeAllQueryParams: {
          fav: 'PERFORMER',
          sort: 'DATE',
          dir: 'DESC',
        },
      },
    ];
  }

  protected totalLoadedScenes(): number {
    return (
      this.favoriteStudiosItems().length + this.favoritePerformersItems().length
    );
  }

  protected activeRailCount(): number {
    return this.rails().filter((rail) => rail.items.length > 0).length;
  }

  protected isPageErrorState(): boolean {
    return (
      !this.loading() &&
      this.favoriteStudiosItems().length === 0 &&
      this.favoritePerformersItems().length === 0 &&
      this.favoriteStudiosError() !== null &&
      this.favoritePerformersError() !== null
    );
  }

  protected isPageEmptyState(): boolean {
    return (
      !this.loading() &&
      this.favoriteStudiosItems().length === 0 &&
      this.favoritePerformersItems().length === 0 &&
      this.favoriteStudiosError() === null &&
      this.favoritePerformersError() === null
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
    this.favoriteStudiosItems.update((items) =>
      this.patchSubmittedRequest(items, stashId),
    );
    this.favoritePerformersItems.update((items) =>
      this.patchSubmittedRequest(items, stashId),
    );
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

  private loadRail(
    favorites: Extract<SceneFavoritesFilter, 'STUDIO' | 'PERFORMER'>,
    fallbackError: string,
  ) {
    return this.discoverService
      .getScenesFeed(
        1,
        HomePageComponent.RAIL_SIZE,
        'DATE',
        'DESC',
        undefined,
        undefined,
        favorites,
      )
      .pipe(
        map((response): RailLoadResult => ({
          items: response.items,
          error: null,
        })),
        catchError(() =>
          of<RailLoadResult>({
            items: [],
            error: fallbackError,
          }),
        ),
      );
  }

  private patchSubmittedRequest(
    items: DiscoverItem[],
    stashId: string,
  ): DiscoverItem[] {
    return items.map((item) =>
      item.id === stashId
        ? {
            ...item,
            status: { state: 'DOWNLOADING' },
          }
        : item,
    );
  }

  private findRailViewport(railKey: HomeRailKey): HTMLDivElement | null {
    return (
      this.railViewports?.find(
        (elementRef) => elementRef.nativeElement.dataset['railKey'] === railKey,
      )?.nativeElement ?? null
    );
  }
}
