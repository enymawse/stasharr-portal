import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { AcquisitionService } from '../../core/api/acquisition.service';
import {
  AcquisitionLifecycleFilter,
  AcquisitionSceneItem,
  AcquisitionScenesResponse,
} from '../../core/api/acquisition.types';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { RuntimeHealthResponse } from '../../core/api/runtime-health.types';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { AcquisitionPageComponent } from './acquisition-page.component';

function buildItem(overrides: Partial<AcquisitionSceneItem> = {}): AcquisitionSceneItem {
  return {
    id: 'scene-1',
    title: 'Scene Title',
    description: 'Scene description',
    imageUrl: 'http://cdn.local/image.jpg',
    cardImageUrl: 'http://cdn.local/card.jpg',
    studioId: 'studio-1',
    studio: 'Studio',
    studioImageUrl: 'http://cdn.local/studio.jpg',
    releaseDate: '2026-03-01',
    duration: 720,
    type: 'SCENE',
    source: 'STASHDB',
    status: { state: 'FAILED' },
    queueStatus: 'failed',
    queueState: 'warning',
    errorMessage: null,
    whisparrViewUrl: 'http://whisparr.local/movie/scene-1',
    ...overrides,
  };
}

function buildResponse(
  items: AcquisitionSceneItem[],
  overrides: Partial<AcquisitionScenesResponse> = {},
): AcquisitionScenesResponse {
  return {
    total: items.length,
    page: 1,
    perPage: 24,
    hasMore: false,
    countsByLifecycle: {
      REQUESTED: items.filter((item) => item.status.state === 'REQUESTED').length,
      DOWNLOADING: items.filter((item) => item.status.state === 'DOWNLOADING').length,
      IMPORT_PENDING: items.filter((item) => item.status.state === 'IMPORT_PENDING').length,
      FAILED: items.filter((item) => item.status.state === 'FAILED').length,
    },
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
    failureThreshold:
      overrides.failureThreshold ?? HEALTHY_RUNTIME_HEALTH.failureThreshold,
    services: {
      catalog: overrides.services?.catalog ?? HEALTHY_RUNTIME_HEALTH.services.catalog,
      stash: overrides.services?.stash ?? HEALTHY_RUNTIME_HEALTH.services.stash,
      whisparr: overrides.services?.whisparr ?? HEALTHY_RUNTIME_HEALTH.services.whisparr,
    },
  };
}

function buildWhisparrDegradedRuntimeHealth(): RuntimeHealthResponse {
  return buildRuntimeHealth({
    degraded: true,
    services: {
      whisparr: {
        service: 'WHISPARR',
        status: 'DEGRADED',
        degraded: true,
        consecutiveFailures: 4,
        lastHealthyAt: '2026-04-01T23:50:00.000Z',
        lastFailureAt: '2026-04-02T00:01:00.000Z',
        lastErrorMessage: 'Failed to reach Whisparr provider endpoint.',
        degradedAt: '2026-04-02T00:01:00.000Z',
      },
    },
  });
}

describe('AcquisitionPageComponent', () => {
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
    responses?: Partial<Record<AcquisitionLifecycleFilter, AcquisitionScenesResponse>>;
    runtimeHealth?: RuntimeHealthResponse;
    setupStatus?: SetupStatusResponse;
  }) {
    const allResponse =
      options?.responses?.ANY ??
      buildResponse([
        buildItem({
          id: 'scene-failed',
          title: 'Failed Scene',
          status: { state: 'FAILED' },
          errorMessage: 'The download is stalled with no connections',
          whisparrViewUrl: 'http://whisparr.local/movie/failed',
        }),
        buildItem({
          id: 'scene-downloading',
          title: 'Downloading Scene',
          status: { state: 'DOWNLOADING' },
          queueStatus: 'downloading',
          queueState: null,
          errorMessage: null,
          whisparrViewUrl: 'http://whisparr.local/movie/downloading',
        }),
        buildItem({
          id: 'scene-requested',
          title: 'Requested Scene',
          status: { state: 'REQUESTED' },
          queueStatus: 'queued',
          queueState: null,
          errorMessage: null,
          whisparrViewUrl: 'http://whisparr.local/movie/requested',
        }),
      ]);
    const responses: Record<AcquisitionLifecycleFilter, AcquisitionScenesResponse> = {
      ANY: allResponse,
      FAILED:
        options?.responses?.FAILED ??
        buildResponse(
          allResponse.items.filter((item) => item.status.state === 'FAILED'),
        ),
      DOWNLOADING:
        options?.responses?.DOWNLOADING ??
        buildResponse(
          allResponse.items.filter((item) => item.status.state === 'DOWNLOADING'),
        ),
      IMPORT_PENDING:
        options?.responses?.IMPORT_PENDING ??
        buildResponse(
          allResponse.items.filter((item) => item.status.state === 'IMPORT_PENDING'),
        ),
      REQUESTED:
        options?.responses?.REQUESTED ??
        buildResponse(
          allResponse.items.filter((item) => item.status.state === 'REQUESTED'),
        ),
    };

    const acquisitionService = {
      getScenesFeed: vi.fn((page: number, perPage: number, lifecycle = 'ANY') =>
        of(responses[lifecycle as AcquisitionLifecycleFilter] ?? responses.ANY),
      ),
    };
    const refreshRequests = new Subject<void>();
    let runtimeHealth = options?.runtimeHealth ?? HEALTHY_RUNTIME_HEALTH;
    const runtimeHealthService = {
      refreshStatus: vi.fn(() => of(runtimeHealth)),
      refreshRequested$: refreshRequests.asObservable(),
      requestRefresh: vi.fn(() => refreshRequests.next()),
    };
    const setupStatusStore = {
      status: signal(options?.setupStatus ?? buildSetupStatus()),
      sync: vi.fn(),
    };
    const activatedRoute = {
      queryParamMap: of(convertToParamMap({})),
      snapshot: {
        queryParamMap: convertToParamMap({}),
      },
    };

    await TestBed.configureTestingModule({
      imports: [AcquisitionPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: AcquisitionService,
          useValue: acquisitionService,
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
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const fixture = TestBed.createComponent(AcquisitionPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {
      fixture,
      acquisitionService,
      runtimeHealthService,
      refreshRequests,
      setRuntimeHealth: (next: RuntimeHealthResponse) => {
        runtimeHealth = next;
      },
    };
  }

  it('renders summary cards, prioritizes failed sections, and exposes scene plus Whisparr actions', async () => {
    const { fixture, acquisitionService, runtimeHealthService } = await renderPage();
    const text = fixture.nativeElement.textContent;
    const failedSummaryCard = fixture.nativeElement.querySelector(
      '[data-testid="summary-card-FAILED"]',
    ) as HTMLElement | null;
    const lifecycleHeadings = Array.from(
      fixture.nativeElement.querySelectorAll('.lifecycle-section h3'),
    ).map((element) => element.textContent?.trim());

    expect(acquisitionService.getScenesFeed).toHaveBeenCalledWith(1, 24, 'ANY');
    expect(runtimeHealthService.refreshStatus).toHaveBeenCalledTimes(1);
    expect(failedSummaryCard?.textContent).toContain('1');
    expect(lifecycleHeadings).toEqual(['Failed', 'Downloading', 'Requested']);
    expect(text).toContain('Whisparr reported: The download is stalled with no connections');
    expect(
      fixture.nativeElement.querySelector('a[href="http://whisparr.local/movie/failed"]')
        ?.textContent,
    ).toContain('View in Whisparr');
    expect(
      fixture.nativeElement.querySelector('.card-actions a[href*="/scene/scene-failed"]'),
    ).toBeTruthy();
  });

  it('reloads the feed when a summary card lifecycle focus is selected', async () => {
    const { fixture, acquisitionService } = await renderPage();
    const failedSummaryCard = fixture.nativeElement.querySelector(
      '[data-testid="summary-card-FAILED"]',
    ) as HTMLButtonElement | null;

    expect(failedSummaryCard).toBeTruthy();

    failedSummaryCard?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(acquisitionService.getScenesFeed).toHaveBeenLastCalledWith(1, 24, 'FAILED');
    expect(fixture.nativeElement.textContent).toContain('Failed Scene');
    expect(fixture.nativeElement.textContent).not.toContain('Downloading Scene');
    expect(fixture.nativeElement.querySelector('[data-testid="lifecycle-section-FAILED"]')).toBeTruthy();
  });

  it('renders acquisition-specific degraded messaging and a strong empty state', async () => {
    const emptyResponse = buildResponse([]);
    const { fixture } = await renderPage({
      responses: {
        ANY: emptyResponse,
      },
      runtimeHealth: buildWhisparrDegradedRuntimeHealth(),
    });

    const degradedState = fixture.nativeElement.querySelector(
      '[data-testid="acquisition-degraded-state"]',
    ) as HTMLElement | null;
    const emptyState = fixture.nativeElement.querySelector(
      '[data-testid="acquisition-empty-state"]',
    ) as HTMLElement | null;

    expect(degradedState?.textContent).toContain('Whisparr needs attention');
    expect(degradedState?.textContent).toContain(
      'Queue state, failures, and request progression may be stale',
    );
    expect(emptyState?.textContent).toContain('Nothing is moving through acquisition right now');
    expect(emptyState?.textContent).toContain('Open Scenes');
    expect(emptyState?.textContent).toContain('Open Library');
  });

  it('shows the acquisition degraded alert when runtime health refresh reports a new Whisparr outage', async () => {
    const { fixture, runtimeHealthService, refreshRequests, setRuntimeHealth } =
      await renderPage();

    expect(
      fixture.nativeElement.querySelector('[data-testid="acquisition-degraded-state"]'),
    ).toBeNull();

    setRuntimeHealth(buildWhisparrDegradedRuntimeHealth());
    refreshRequests.next();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const degradedState = fixture.nativeElement.querySelector(
      '[data-testid="acquisition-degraded-state"]',
    ) as HTMLElement | null;

    expect(runtimeHealthService.refreshStatus).toHaveBeenCalledTimes(2);
    expect(degradedState?.textContent).toContain('Whisparr needs attention');
    expect(degradedState?.textContent).toContain(
      'Queue state, failures, and request progression may be stale',
    );
  });

  it('clears the acquisition degraded alert when runtime health refresh reports recovery', async () => {
    const { fixture, runtimeHealthService, refreshRequests, setRuntimeHealth } =
      await renderPage({
        runtimeHealth: buildWhisparrDegradedRuntimeHealth(),
      });

    expect(
      fixture.nativeElement.querySelector('[data-testid="acquisition-degraded-state"]'),
    ).toBeTruthy();

    setRuntimeHealth(buildRuntimeHealth());
    refreshRequests.next();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(runtimeHealthService.refreshStatus).toHaveBeenCalledTimes(2);
    expect(
      fixture.nativeElement.querySelector('[data-testid="acquisition-degraded-state"]'),
    ).toBeNull();
  });

  it('keeps setup degradation ahead of refreshed runtime outage messaging', async () => {
    const { fixture, refreshRequests, setRuntimeHealth } = await renderPage({
      setupStatus: buildSetupStatus({
        setupComplete: false,
        required: {
          stash: true,
          catalog: true,
          whisparr: false,
        },
      }),
    });

    setRuntimeHealth(
      buildRuntimeHealth({
        degraded: true,
        services: {
          stash: {
            service: 'STASH',
            status: 'DEGRADED',
            degraded: true,
            consecutiveFailures: 2,
            lastHealthyAt: '2026-04-02T00:00:00.000Z',
            lastFailureAt: '2026-04-02T00:01:00.000Z',
            lastErrorMessage: 'Failed to reach Stash provider endpoint.',
            degradedAt: '2026-04-02T00:01:00.000Z',
          },
        },
      }),
    );
    refreshRequests.next();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const degradedState = fixture.nativeElement.querySelector(
      '[data-testid="acquisition-degraded-state"]',
    ) as HTMLElement | null;

    expect(degradedState?.textContent).toContain('Repair Required');
    expect(degradedState?.textContent).toContain('Whisparr needs attention');
    expect(degradedState?.textContent).not.toContain('Stash import visibility is degraded');
  });

  it('polls runtime health while mounted and stops refreshing after destroy', async () => {
    vi.useFakeTimers();

    try {
      const { fixture, runtimeHealthService, refreshRequests, setRuntimeHealth } =
        await renderPage();

      expect(runtimeHealthService.refreshStatus).toHaveBeenCalledTimes(1);

      setRuntimeHealth(buildWhisparrDegradedRuntimeHealth());
      await vi.advanceTimersByTimeAsync(30_000);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(runtimeHealthService.refreshStatus).toHaveBeenCalledTimes(2);
      expect(
        fixture.nativeElement.querySelector('[data-testid="acquisition-degraded-state"]'),
      ).toBeTruthy();

      fixture.destroy();
      setRuntimeHealth(buildRuntimeHealth());
      refreshRequests.next();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(runtimeHealthService.refreshStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a filter-specific empty state when a focused lifecycle has no items', async () => {
    const { fixture, acquisitionService } = await renderPage({
      responses: {
        ANY: buildResponse([
          buildItem({
            id: 'scene-downloading',
            title: 'Downloading Scene',
            status: { state: 'DOWNLOADING' },
            queueStatus: 'downloading',
            queueState: null,
            errorMessage: null,
            whisparrViewUrl: 'http://whisparr.local/movie/downloading',
          }),
        ]),
        FAILED: buildResponse([]),
      },
    });

    const failedSummaryCard = fixture.nativeElement.querySelector(
      '[data-testid="summary-card-FAILED"]',
    ) as HTMLButtonElement | null;

    failedSummaryCard?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(acquisitionService.getScenesFeed).toHaveBeenLastCalledWith(1, 24, 'FAILED');
    expect(fixture.nativeElement.textContent).toContain('No failed scenes right now');
    expect(fixture.nativeElement.textContent).toContain('Show all tracked');
  });
});
