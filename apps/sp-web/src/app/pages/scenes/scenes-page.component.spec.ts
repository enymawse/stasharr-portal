import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { SceneExplorerItem, ScenesFeedResponse } from '../../core/api/discover.types';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { RuntimeHealthResponse } from '../../core/api/runtime-health.types';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { ScenesPageComponent } from './scenes-page.component';

function buildScene(overrides: Partial<SceneExplorerItem> = {}): SceneExplorerItem {
  return {
    id: 'scene-1',
    title: 'Scene Title',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/image.jpg',
    cardImageUrl: 'http://cdn.local/card.jpg',
    studioId: 'studio-1',
    studio: 'Studio Name',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    releaseDate: '2026-03-01',
    duration: 640,
    type: 'SCENE',
    source: 'STASHDB',
    status: { state: 'NOT_REQUESTED' },
    requestable: true,
    ...overrides,
  };
}

function buildFeedResponse(
  items: SceneExplorerItem[] = [buildScene()],
  overrides: Partial<ScenesFeedResponse> = {},
): ScenesFeedResponse {
  return {
    total: items.length,
    page: 1,
    perPage: 24,
    hasMore: false,
    items,
    ...overrides,
  };
}

function buildSetupStatus(
  overrides: Partial<Omit<SetupStatusResponse, 'required'>> & {
    required?: Partial<SetupStatusResponse['required']>;
  } = {},
): SetupStatusResponse {
  return {
    setupComplete: overrides.setupComplete ?? true,
    required: {
      stash: true,
      catalog: true,
      whisparr: true,
      ...(overrides.required ?? {}),
    },
    catalogProvider: overrides.catalogProvider ?? 'STASHDB',
  };
}

const HEALTHY_RUNTIME_HEALTH: RuntimeHealthResponse = {
  degraded: false,
  failureThreshold: 3,
  services: {
    catalog: {
      service: 'CATALOG',
      status: 'HEALTHY',
      degraded: false,
      consecutiveFailures: 0,
      lastHealthyAt: '2026-04-02T00:00:00.000Z',
      lastFailureAt: null,
      lastErrorMessage: null,
      degradedAt: null,
    },
    stash: {
      service: 'STASH',
      status: 'HEALTHY',
      degraded: false,
      consecutiveFailures: 0,
      lastHealthyAt: '2026-04-02T00:00:00.000Z',
      lastFailureAt: null,
      lastErrorMessage: null,
      degradedAt: null,
    },
    whisparr: {
      service: 'WHISPARR',
      status: 'HEALTHY',
      degraded: false,
      consecutiveFailures: 0,
      lastHealthyAt: '2026-04-02T00:00:00.000Z',
      lastFailureAt: null,
      lastErrorMessage: null,
      degradedAt: null,
    },
  },
};

describe('ScenesPageComponent', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  async function renderPage(
    initialQueryParams: Record<string, string> = {},
    options?: {
      feedResponse?: ScenesFeedResponse;
      runtimeHealth?: RuntimeHealthResponse;
      setupStatus?: SetupStatusResponse;
    },
  ) {
    const queryParamMap = convertToParamMap(initialQueryParams);
    const queryParamMap$ = new BehaviorSubject(queryParamMap);
    const discoverService = {
      getScenesFeed: vi.fn().mockReturnValue(of(options?.feedResponse ?? buildFeedResponse())),
      searchSceneTags: vi.fn().mockReturnValue(of([])),
      searchPerformerStudios: vi.fn().mockReturnValue(of([])),
    };
    const runtimeHealthService = {
      ensureStarted: vi.fn(),
      status: signal(options?.runtimeHealth ?? HEALTHY_RUNTIME_HEALTH).asReadonly(),
    };
    const setupStatusStore = {
      status: signal(options?.setupStatus ?? buildSetupStatus()),
      sync: vi.fn(),
    };
    const activatedRoute = {
      queryParamMap: queryParamMap$.asObservable(),
      snapshot: {
        queryParamMap,
      },
    };

    await TestBed.configureTestingModule({
      imports: [ScenesPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: DiscoverService,
          useValue: discoverService,
        },
        {
          provide: AppNotificationsService,
          useValue: {
            success: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRoute,
        },
        {
          provide: RuntimeHealthService,
          useValue: runtimeHealthService,
        },
        {
          provide: SetupStatusStore,
          useValue: setupStatusStore,
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(ScenesPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, discoverService, navigateSpy, runtimeHealthService };
  }

  it('initializes the canonical scenes discovery view with TRENDING sort', async () => {
    const { fixture, discoverService, navigateSpy, runtimeHealthService } = await renderPage();
    const resetButton = fixture.nativeElement.querySelector(
      '.reset-filters-button',
    ) as HTMLButtonElement | null;
    const pageText = fixture.nativeElement.textContent ?? '';

    expect(discoverService.getScenesFeed).toHaveBeenCalledWith(
      1,
      24,
      'TRENDING',
      'DESC',
      [],
      'OR',
      undefined,
      [],
    );
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(resetButton?.disabled).toBe(true);
    expect(pageText).not.toContain('Already In Library');
    expect(pageText).not.toContain('Missing From Library');
    expect(pageText).not.toContain('Favorite Tags');
    expect(runtimeHealthService.ensureStarted).toHaveBeenCalledTimes(1);
  });

  it('renders discovery results through the shared scene card and forwards request actions', async () => {
    const { fixture } = await renderPage();
    const component = fixture.componentInstance as any;
    const cards = fixture.nativeElement.querySelectorAll('app-scene-card');
    const requestButton = fixture.nativeElement.querySelector(
      '.request-cta',
    ) as HTMLButtonElement | null;

    expect(cards).toHaveLength(1);
    expect(component.requestModalOpen()).toBe(false);

    requestButton?.click();

    expect(component.requestModalOpen()).toBe(true);
    expect(component.requestContext()).toEqual({
      id: 'scene-1',
      title: 'Scene Title',
      imageUrl: 'http://cdn.local/image.jpg',
    });
  });

  it('clears active filters back to the default trending discovery state', async () => {
    const { fixture, discoverService, navigateSpy } = await renderPage({
      sort: 'DATE',
      dir: 'ASC',
      fav: 'ALL',
      mode: 'AND',
      tags: 'tag-1,tag-2',
      tagNames: 'Tag One,Tag Two',
      studios: 'studio-1,studio-2',
      studioNames: 'Studio One,Studio Two',
    });
    const resetButton = fixture.nativeElement.querySelector(
      '.reset-filters-button',
    ) as HTMLButtonElement | null;

    expect(resetButton).toBeTruthy();
    expect(resetButton?.disabled).toBe(false);

    resetButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(discoverService.getScenesFeed).toHaveBeenLastCalledWith(
      1,
      24,
      'TRENDING',
      'DESC',
      [],
      'OR',
      undefined,
      [],
    );
    expect(navigateSpy).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: {
        sort: null,
        dir: null,
        fav: null,
        availability: null,
        lifecycle: null,
        stashFavPerformers: null,
        stashFavStudios: null,
        stashFavTags: null,
        mode: null,
        tags: null,
        tagNames: null,
        studios: null,
        studioNames: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: false,
    });
  });

  it('strips legacy library overlay params from the discovery route', async () => {
    const { discoverService, navigateSpy } = await renderPage({
      availability: 'IN_LIBRARY',
      stashFavPerformers: '1',
      stashFavStudios: '1',
      stashFavTags: '1',
    });

    expect(discoverService.getScenesFeed).toHaveBeenCalledWith(
      1,
      24,
      'TRENDING',
      'DESC',
      [],
      'OR',
      undefined,
      [],
    );
    expect(navigateSpy).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: {
        sort: null,
        dir: null,
        fav: null,
        availability: null,
        lifecycle: null,
        stashFavPerformers: null,
        stashFavStudios: null,
        stashFavTags: null,
        mode: null,
        tags: null,
        tagNames: null,
        studios: null,
        studioNames: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  it('renders first-use guidance when the catalog feed is empty', async () => {
    const { fixture } = await renderPage(
      {},
      {
        feedResponse: buildFeedResponse([], { total: 0 }),
      },
    );

    const emptyState = fixture.nativeElement.querySelector(
      '[data-testid="scenes-empty-state"]',
    ) as HTMLElement | null;

    expect(emptyState?.textContent).toContain('No catalog scenes are available yet');
    expect(emptyState?.textContent).toContain('Catalog browsing does not depend on local indexing');
    expect(emptyState?.textContent).toContain('Open indexing');
  });

  it('points users to integration repair when catalog discovery is degraded', async () => {
    const { fixture } = await renderPage(
      {},
      {
        feedResponse: buildFeedResponse([], { total: 0 }),
        setupStatus: buildSetupStatus({
          setupComplete: false,
          required: {
            catalog: false,
          },
        }),
      },
    );

    const alert = fixture.nativeElement.querySelector(
      '[data-testid="scenes-readiness-alert"]',
    ) as HTMLElement | null;
    const repairLink = alert?.querySelector('a[href*="/settings/integrations"]');

    expect(alert?.textContent).toContain('Catalog discovery needs attention');
    expect(fixture.nativeElement.textContent).toContain('Repair integrations');
    expect(repairLink).toBeTruthy();
  });
});
