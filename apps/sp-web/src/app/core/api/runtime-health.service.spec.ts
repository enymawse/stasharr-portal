import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
import { AcquisitionService } from './acquisition.service';
import { RuntimeHealthResponse } from './runtime-health.types';
import { RuntimeHealthService } from './runtime-health.service';
import { SetupService } from './setup.service';
import { SetupStatusStore } from './setup-status.store';
import { SetupStatusResponse } from './setup.types';
import { AuthService } from './auth.service';
import { AppNotificationsService } from '../notifications/app-notifications.service';
import { AppShellLayoutComponent } from '../../layouts/app-shell-layout/app-shell-layout.component';
import { AcquisitionPageComponent } from '../../pages/acquisition/acquisition-page.component';

function buildSetupStatus(overrides: Partial<SetupStatusResponse> = {}): SetupStatusResponse {
  const required = {
    stash: true,
    catalog: true,
    whisparr: true,
    ...(overrides.required ?? {}),
  };

  return {
    setupComplete: overrides.setupComplete ?? true,
    required,
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

describe('RuntimeHealthService', () => {
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('coalesces overlapping refresh triggers into one active probe and keeps polling after completion', async () => {
    vi.useFakeTimers();

    const refreshStreams: Subject<RuntimeHealthResponse>[] = [];
    const httpClient = {
      get: vi.fn(),
      post: vi.fn(() => {
        const stream = new Subject<RuntimeHealthResponse>();
        refreshStreams.push(stream);
        return stream.asObservable();
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        RuntimeHealthService,
        {
          provide: HttpClient,
          useValue: httpClient,
        },
      ],
    });

    const service = TestBed.inject(RuntimeHealthService);
    const degradedHealth = buildWhisparrDegradedRuntimeHealth();

    service.ensureStarted();

    expect(httpClient.post).toHaveBeenCalledTimes(1);

    service.requestRefresh();
    service.requestRefresh();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(httpClient.post).toHaveBeenCalledTimes(1);

    refreshStreams[0].next(HEALTHY_RUNTIME_HEALTH);
    refreshStreams[0].complete();

    expect(service.status()).toEqual(HEALTHY_RUNTIME_HEALTH);

    service.requestRefresh();

    expect(httpClient.post).toHaveBeenCalledTimes(2);

    refreshStreams[1].next(degradedHealth);
    refreshStreams[1].complete();

    expect(service.status()).toEqual(degradedHealth);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(httpClient.post).toHaveBeenCalledTimes(3);
  });

  it('shares one runtime-health source across shell and acquisition and updates both together', async () => {
    const refreshResponses = [HEALTHY_RUNTIME_HEALTH, buildWhisparrDegradedRuntimeHealth()];
    const httpClient = {
      get: vi.fn(),
      post: vi.fn(() => of(refreshResponses.shift() ?? HEALTHY_RUNTIME_HEALTH)),
    };
    const setupService = {
      getStatus: vi.fn().mockReturnValue(of(buildSetupStatus())),
    };
    const acquisitionService = {
      getScenesFeed: vi.fn(() =>
        of({
          total: 0,
          page: 1,
          perPage: 24,
          hasMore: false,
          countsByLifecycle: {
            REQUESTED: 0,
            DOWNLOADING: 0,
            IMPORT_PENDING: 0,
            FAILED: 0,
          },
          items: [],
        }),
      ),
    };
    const authService = {
      status: () => ({
        bootstrapRequired: false,
        authenticated: true,
        username: 'admin',
      }),
      logout: vi.fn(),
      clearStatus: vi.fn(),
    };
    const notifications = {
      info: vi.fn(),
    };
    const activatedRoute = {
      queryParamMap: of(convertToParamMap({})),
      snapshot: {
        queryParamMap: convertToParamMap({}),
      },
    };

    await TestBed.configureTestingModule({
      imports: [AppShellLayoutComponent, AcquisitionPageComponent],
      providers: [
        provideRouter([]),
        RuntimeHealthService,
        SetupStatusStore,
        {
          provide: HttpClient,
          useValue: httpClient,
        },
        {
          provide: SetupService,
          useValue: setupService,
        },
        {
          provide: AcquisitionService,
          useValue: acquisitionService,
        },
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: AppNotificationsService,
          useValue: notifications,
        },
        {
          provide: ActivatedRoute,
          useValue: activatedRoute,
        },
      ],
    }).compileComponents();

    const shellFixture = TestBed.createComponent(AppShellLayoutComponent);
    shellFixture.detectChanges();
    await shellFixture.whenStable();
    shellFixture.detectChanges();

    const acquisitionFixture = TestBed.createComponent(AcquisitionPageComponent);
    acquisitionFixture.detectChanges();
    await acquisitionFixture.whenStable();
    acquisitionFixture.detectChanges();

    expect(httpClient.post).toHaveBeenCalledTimes(1);
    expect(shellFixture.nativeElement.querySelector('[data-testid="degraded-banner"]')).toBeNull();
    expect(
      acquisitionFixture.nativeElement.querySelector('[data-testid="acquisition-degraded-state"]'),
    ).toBeNull();

    const service = TestBed.inject(RuntimeHealthService);
    service.requestRefresh();

    shellFixture.detectChanges();
    acquisitionFixture.detectChanges();
    await shellFixture.whenStable();
    await acquisitionFixture.whenStable();
    shellFixture.detectChanges();
    acquisitionFixture.detectChanges();

    const shellBanner = shellFixture.nativeElement.querySelector(
      '[data-testid="degraded-banner"]',
    ) as HTMLElement | null;
    const acquisitionAlert = acquisitionFixture.nativeElement.querySelector(
      '[data-testid="acquisition-degraded-state"]',
    ) as HTMLElement | null;

    expect(httpClient.post).toHaveBeenCalledTimes(2);
    expect(shellBanner?.textContent).toContain('Whisparr is currently unavailable.');
    expect(acquisitionAlert?.textContent).toContain('Whisparr needs attention');
    expect(acquisitionAlert?.textContent).toContain(
      'Queue state, failures, and request progression may be stale',
    );
  });
});
