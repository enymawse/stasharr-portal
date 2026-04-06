import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { LibraryService } from '../../core/api/library.service';
import { LibrarySceneItem, LibraryScenesFeedResponse } from '../../core/api/library.types';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { RuntimeHealthResponse } from '../../core/api/runtime-health.types';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { LibraryPageComponent } from './library-page.component';

function buildScene(overrides: Partial<LibrarySceneItem> = {}): LibrarySceneItem {
  return {
    id: '411',
    activeCatalogSceneId: 'stash-411',
    title: 'Fresh Local Scene',
    description: 'Already in the library.',
    imageUrl: '/api/media/stash/scenes/411/screenshot',
    cardImageUrl: '/api/media/stash/scenes/411/screenshot',
    studioId: 'studio-1',
    studio: 'Archive',
    studioImageUrl: '/api/media/stash/studios/studio-1/logo',
    performerNames: ['Performer One', 'Performer Two'],
    releaseDate: '2026-03-24',
    duration: 1800,
    localCreatedAt: '2026-03-23T00:00:00.000Z',
    type: 'SCENE',
    source: 'STASH',
    viewUrl: 'http://stash.local/scenes/411',
    ...overrides,
  };
}

function buildFeedResponse(
  items: LibrarySceneItem[] = [buildScene()],
  overrides: Partial<LibraryScenesFeedResponse> = {},
): LibraryScenesFeedResponse {
  return {
    total: items.length,
    page: 1,
    perPage: 24,
    hasMore: false,
    latestSyncAt: '2026-04-02T00:00:00.000Z',
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

function buildRuntimeHealth(
  overrides: Partial<Omit<RuntimeHealthResponse, 'services'>> & {
    services?: Partial<RuntimeHealthResponse['services']>;
  } = {},
): RuntimeHealthResponse {
  return {
    degraded: overrides.degraded ?? HEALTHY_RUNTIME_HEALTH.degraded,
    failureThreshold: overrides.failureThreshold ?? HEALTHY_RUNTIME_HEALTH.failureThreshold,
    services: {
      catalog: overrides.services?.catalog ?? HEALTHY_RUNTIME_HEALTH.services.catalog,
      stash: overrides.services?.stash ?? HEALTHY_RUNTIME_HEALTH.services.stash,
      whisparr: overrides.services?.whisparr ?? HEALTHY_RUNTIME_HEALTH.services.whisparr,
    },
  };
}

describe('LibraryPageComponent', () => {
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

  async function renderPage(options?: {
    initialQueryParams?: Record<string, string>;
    feedResponse?: LibraryScenesFeedResponse;
    runtimeHealth?: RuntimeHealthResponse;
    setupStatus?: SetupStatusResponse;
  }) {
    const queryParamMap = convertToParamMap(options?.initialQueryParams ?? {});
    const queryParamMap$ = new BehaviorSubject(queryParamMap);
    const libraryService = {
      getScenesFeed: vi.fn().mockReturnValue(of(options?.feedResponse ?? buildFeedResponse())),
      searchTags: vi.fn().mockReturnValue(of([])),
      searchStudios: vi.fn().mockReturnValue(of([])),
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
      imports: [LibraryPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: LibraryService,
          useValue: libraryService,
        },
        {
          provide: RuntimeHealthService,
          useValue: runtimeHealthService,
        },
        {
          provide: SetupStatusStore,
          useValue: setupStatusStore,
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRoute,
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    Object.defineProperty(router, 'url', {
      configurable: true,
      get: () => '/library',
    });
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(LibraryPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, libraryService, navigateSpy, runtimeHealthService };
  }

  it('loads the default local-library view from the dedicated library API', async () => {
    const { fixture, libraryService, navigateSpy, runtimeHealthService } = await renderPage();
    const resetButton = fixture.nativeElement.querySelector(
      '.controls-header .reset-filters-button',
    ) as HTMLButtonElement | null;

    expect(runtimeHealthService.ensureStarted).toHaveBeenCalledTimes(1);
    expect(libraryService.getScenesFeed).toHaveBeenCalledWith(1, 24, {
      query: undefined,
      sort: 'RELEASE_DATE',
      direction: 'DESC',
      tagIds: [],
      tagMode: 'OR',
      studioIds: [],
      favoritePerformersOnly: false,
      favoriteStudiosOnly: false,
      favoriteTagsOnly: false,
    });
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(resetButton?.disabled).toBe(true);
  });

  it('clears active local-library filters back to the default indexed library view', async () => {
    const { fixture, libraryService, navigateSpy } = await renderPage({
      initialQueryParams: {
        query: 'archive',
        sort: 'TITLE',
        dir: 'ASC',
        mode: 'AND',
        tags: 'tag-1,tag-2',
        tagNames: 'Tag One,Tag Two',
        studios: 'studio-1,studio-2',
        studioNames: 'Archive,North Block',
      },
    });
    const resetButton = fixture.nativeElement.querySelector(
      '.controls-header .reset-filters-button',
    ) as HTMLButtonElement | null;

    expect(resetButton).toBeTruthy();
    expect(resetButton?.disabled).toBe(false);
    expect(
      fixture.nativeElement.querySelector('[data-testid="library-active-filters"]')?.textContent,
    ).toContain('Query: archive');

    resetButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(libraryService.getScenesFeed).toHaveBeenLastCalledWith(1, 24, {
      query: undefined,
      sort: 'RELEASE_DATE',
      direction: 'DESC',
      tagIds: [],
      tagMode: 'OR',
      studioIds: [],
      favoritePerformersOnly: false,
      favoriteStudiosOnly: false,
      favoriteTagsOnly: false,
    });
    expect(navigateSpy).toHaveBeenCalledWith([], {
      relativeTo: expect.anything(),
      queryParams: {
        query: null,
        sort: null,
        dir: null,
        favoritePerformersOnly: null,
        favoriteStudiosOnly: null,
        favoriteTagsOnly: null,
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

  it('loads local favorite overlay filters from the library route', async () => {
    const { libraryService } = await renderPage({
      initialQueryParams: {
        favoritePerformersOnly: '1',
        favoriteStudiosOnly: '1',
        favoriteTagsOnly: '1',
      },
    });

    expect(libraryService.getScenesFeed).toHaveBeenCalledWith(1, 24, {
      query: undefined,
      sort: 'RELEASE_DATE',
      direction: 'DESC',
      tagIds: [],
      tagMode: 'OR',
      studioIds: [],
      favoritePerformersOnly: true,
      favoriteStudiosOnly: true,
      favoriteTagsOnly: true,
    });
  });

  it('renders a library-specific degraded alert when stash runtime health is down', async () => {
    const { fixture } = await renderPage({
      runtimeHealth: buildRuntimeHealth({
        degraded: true,
        services: {
          stash: {
            service: 'STASH',
            status: 'DEGRADED',
            degraded: true,
            consecutiveFailures: 4,
            lastHealthyAt: '2026-04-01T23:50:00.000Z',
            lastFailureAt: '2026-04-02T00:01:00.000Z',
            lastErrorMessage: 'Failed to reach Stash.',
            degradedAt: '2026-04-02T00:01:00.000Z',
          },
        },
      }),
    });

    const degradedAlert = fixture.nativeElement.querySelector(
      '[data-testid="library-degraded-state"]',
    ) as HTMLElement | null;

    expect(degradedAlert?.textContent).toContain('Local library freshness is degraded');
    expect(degradedAlert?.textContent).toContain(
      'Currently showing projected library data synced through',
    );
    expect(degradedAlert?.textContent).toContain('Newly imported scenes');
  });

  it('renders an intentional empty state when the local library has no indexed scenes yet', async () => {
    const { fixture } = await renderPage({
      feedResponse: buildFeedResponse([], { latestSyncAt: null }),
    });

    expect(fixture.nativeElement.textContent).toContain('No local scenes are indexed yet');
    expect(
      fixture.nativeElement.querySelector('[data-testid="library-empty-state"]')?.textContent,
    ).toContain('Track Imports');
  });

  it('renders a no-match empty state when filters narrow the library to zero scenes', async () => {
    const { fixture } = await renderPage({
      initialQueryParams: {
        query: 'archive',
      },
      feedResponse: buildFeedResponse([], { latestSyncAt: '2026-04-02T00:00:00.000Z' }),
    });

    expect(fixture.nativeElement.textContent).toContain('Nothing matches the current library view');
    expect(
      fixture.nativeElement.querySelector('[data-testid="library-empty-state"]')?.textContent,
    ).toContain('Clear filters');
  });

  it('uses the compact scenes-style shell while preserving local-library controls', async () => {
    const { fixture } = await renderPage({
      feedResponse: buildFeedResponse([buildScene({ description: null })]),
    });

    expect(fixture.nativeElement.querySelector('.summary-shell')).toBeNull();
    expect(fixture.nativeElement.querySelector('.results-shell')).toBeNull();
    expect(fixture.nativeElement.querySelector('header .state')?.textContent).toContain(
      '1 local scene / Release newest',
    );
    expect(fixture.nativeElement.querySelector('.controls-note')?.textContent).toContain(
      'Filters apply to indexed local scenes',
    );
    expect(fixture.nativeElement.querySelector('.controls-row input[type="search"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('p-multiselect')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('p-select')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.grid')).toBeTruthy();
  });

  it('renders the shared compact scene card with minimal library-specific actions and badges', async () => {
    const { fixture } = await renderPage({
      feedResponse: buildFeedResponse([
        buildScene({ id: '411', activeCatalogSceneId: 'stash-411' }),
        buildScene({
          id: '412',
          activeCatalogSceneId: null,
          viewUrl: 'http://stash.local/scenes/412',
        }),
      ]),
    });

    expect(fixture.nativeElement.querySelectorAll('app-scene-card')).toHaveLength(2);

    const articles = Array.from(
      fixture.nativeElement.querySelectorAll('article.card'),
    ) as HTMLElement[];

    expect(articles[0]?.querySelector('.media-link-stretch')?.getAttribute('href')).toContain(
      '/scene/stash-411',
    );
    expect(articles[0]?.querySelector('.media-link-stretch')?.getAttribute('href')).toContain(
      'returnTo=%2Flibrary',
    );
    expect(articles[0]?.querySelector('.studio-badge-link')?.getAttribute('href')).toContain(
      '/library',
    );
    expect(articles[0]?.querySelector('.top-badge')?.textContent).toContain('Local');
    expect(articles[0]?.querySelector('.footer-link')?.getAttribute('href')).toBe(
      'http://stash.local/scenes/411',
    );
    expect(articles[0]?.querySelector('.card-actions')).toBeNull();
    expect(articles[0]?.querySelector('.card-links')).toBeNull();
    expect(articles[0]?.querySelector('.card-stat-pills')).toBeNull();

    expect(articles[1]?.querySelector('.media-link-stretch')?.getAttribute('href')).toBe(
      'http://stash.local/scenes/412',
    );
    expect(articles[1]?.querySelector('.footer-pill')?.textContent).toContain('Local only');
  });
});
