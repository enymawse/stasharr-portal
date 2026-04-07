import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/api/auth.service';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { RuntimeHealthResponse } from '../../core/api/runtime-health.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { AppShellLayoutComponent } from './app-shell-layout.component';

describe('AppShellLayoutComponent', () => {
  function installMatchMedia(isPhone = false) {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const media = '(max-width: 720px)';
    const mediaQueryList = {
      matches: isPhone,
      media,
      onchange: null,
      addEventListener: vi.fn(
        (eventName: string, listener: (event: MediaQueryListEvent) => void) => {
          if (eventName === 'change') {
            listeners.add(listener);
          }
        },
      ),
      removeEventListener: vi.fn(
        (eventName: string, listener: (event: MediaQueryListEvent) => void) => {
          if (eventName === 'change') {
            listeners.delete(listener);
          }
        },
      ),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => {
        if (query === media) {
          return mediaQueryList;
        }

        return {
          ...mediaQueryList,
          matches: false,
          media: query,
        };
      }),
    );

    return {
      setMatches(next: boolean) {
        (mediaQueryList as { matches: boolean }).matches = next;
        listeners.forEach((listener) =>
          listener({
            matches: next,
            media,
          } as MediaQueryListEvent),
        );
      },
    };
  }

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

  function buildRuntimeHealth(
    overrides: Partial<RuntimeHealthResponse> = {},
  ): RuntimeHealthResponse {
    return {
      degraded: false,
      failureThreshold: 2,
      services: {
        catalog: {
          service: 'CATALOG',
          status: 'HEALTHY',
          degraded: false,
          consecutiveFailures: 0,
          lastHealthyAt: null,
          lastFailureAt: null,
          lastErrorMessage: null,
          degradedAt: null,
        },
        stash: {
          service: 'STASH',
          status: 'HEALTHY',
          degraded: false,
          consecutiveFailures: 0,
          lastHealthyAt: null,
          lastFailureAt: null,
          lastErrorMessage: null,
          degradedAt: null,
        },
        whisparr: {
          service: 'WHISPARR',
          status: 'HEALTHY',
          degraded: false,
          consecutiveFailures: 0,
          lastHealthyAt: null,
          lastFailureAt: null,
          lastErrorMessage: null,
          degradedAt: null,
        },
      },
      ...overrides,
    };
  }

  async function renderComponent(
    {
      setupStatus = buildSetupStatus(),
      runtimeHealth = buildRuntimeHealth(),
      isPhone = false,
    }: {
      setupStatus?: SetupStatusResponse;
      runtimeHealth?: RuntimeHealthResponse;
      isPhone?: boolean;
    } = {},
  ) {
    const viewport = installMatchMedia(isPhone);
    const runtimeHealthState = signal(runtimeHealth);
    const authStatus = signal({
      bootstrapRequired: false,
      authenticated: true,
      username: 'admin',
    });
    const setupService = {
      getStatus: vi.fn().mockReturnValue(of(setupStatus)),
    };
    const authService = {
      status: authStatus.asReadonly(),
      logout: vi.fn().mockReturnValue(
        of({
          bootstrapRequired: false,
          authenticated: false,
          username: null,
        }),
      ),
      clearStatus: vi.fn(),
    };
    const runtimeHealthService = {
      ensureStarted: vi.fn(),
      requestRefresh: vi.fn(),
      stop: vi.fn(),
      status: runtimeHealthState.asReadonly(),
    };
    const notifications = {
      info: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AppShellLayoutComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: SetupService,
          useValue: setupService,
        },
        {
          provide: RuntimeHealthService,
          useValue: runtimeHealthService,
        },
        {
          provide: AppNotificationsService,
          useValue: notifications,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppShellLayoutComponent);
    const router = TestBed.inject(Router);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {
      fixture,
      authService,
      notifications,
      router,
      runtimeHealthService,
      viewport,
      setRuntimeHealth: (next: RuntimeHealthResponse) => runtimeHealthState.set(next),
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('renders the desktop sidebar navigation without a degraded warning when all required services are ready', async () => {
    const { fixture, runtimeHealthService } = await renderComponent();
    const navLinks = Array.from(
      fixture.nativeElement.querySelectorAll('a.nav-item') as NodeListOf<HTMLAnchorElement>,
    );
    const navLabels = navLinks
      .map((link) => link.textContent?.replace(/\s+/g, ' ').trim())
      .filter((label): label is string => Boolean(label));

    expect(runtimeHealthService.ensureStarted).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[data-testid="desktop-sidebar"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="mobile-bottom-nav"]')).toBeNull();
    expect(navLabels).toEqual([
      'Home',
      'Scenes',
      'Acquisition',
      'Library',
      'Performers',
      'Studios',
      'Settings',
    ]);
    expect(
      navLinks.find((link) => link.textContent?.includes('Scenes'))?.getAttribute('href'),
    ).toContain('/scenes');
    expect(fixture.nativeElement.querySelector('[data-testid="degraded-banner"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="settings-nav-indicator"]'),
    ).toBeNull();
  });

  it('renders a bottom navigation on phones and exposes secondary destinations from More', async () => {
    const { fixture } = await renderComponent({
      isPhone: true,
    });

    const desktopSidebar = fixture.nativeElement.querySelector('[data-testid="desktop-sidebar"]');
    const bottomNav = fixture.nativeElement.querySelector(
      '[data-testid="mobile-bottom-nav"]',
    ) as HTMLElement | null;
    const bottomNavItems = Array.from(
      fixture.nativeElement.querySelectorAll('.mobile-nav-item') as NodeListOf<HTMLElement>,
    ).map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
    const moreTrigger = fixture.nativeElement.querySelector(
      '[data-testid="mobile-more-trigger"]',
    ) as HTMLButtonElement | null;

    expect(desktopSidebar).toBeNull();
    expect(bottomNav).toBeTruthy();
    expect(bottomNavItems).toEqual(['Home', 'Scenes', 'Acquisition', 'Library', 'More']);

    moreTrigger?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const moreSheet = fixture.nativeElement.querySelector(
      '[data-testid="mobile-more-sheet"]',
    ) as HTMLElement | null;

    expect(moreSheet).toBeTruthy();
    expect(moreSheet?.textContent).toContain('Performers');
    expect(moreSheet?.textContent).toContain('Studios');
    expect(moreSheet?.textContent).toContain('Settings');
    expect(moreSheet?.textContent).toContain('Log out');
  });

  it('keeps repair visibility available from the phone shell', async () => {
    const { fixture } = await renderComponent({
      isPhone: true,
      setupStatus: buildSetupStatus(),
      runtimeHealth: buildRuntimeHealth({
        degraded: true,
        services: {
          ...buildRuntimeHealth().services,
          whisparr: {
            service: 'WHISPARR',
            status: 'DEGRADED',
            degraded: true,
            consecutiveFailures: 2,
            lastHealthyAt: '2026-04-02T00:00:00.000Z',
            lastFailureAt: '2026-04-02T00:01:00.000Z',
            lastErrorMessage: 'Failed to reach Whisparr provider endpoint.',
            degradedAt: '2026-04-02T00:01:00.000Z',
          },
        },
      }),
    });

    const moreIndicator = fixture.nativeElement.querySelector(
      '[data-testid="mobile-more-indicator"]',
    ) as HTMLElement | null;
    const moreTrigger = fixture.nativeElement.querySelector(
      '[data-testid="mobile-more-trigger"]',
    ) as HTMLButtonElement | null;

    expect(moreIndicator).toBeTruthy();

    moreTrigger?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const settingsIndicator = fixture.nativeElement.querySelector(
      '[data-testid="mobile-settings-nav-indicator"]',
    ) as HTMLElement | null;

    expect(settingsIndicator?.textContent).toContain('Repair');
    expect(fixture.nativeElement.querySelector('[data-testid="degraded-banner"]')).toBeTruthy();
  });

  it('keeps logout accessible from the phone shell and returns the admin to /login', async () => {
    const { fixture, authService, notifications, router } = await renderComponent({
      isPhone: true,
    });
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const moreTrigger = fixture.nativeElement.querySelector(
      '[data-testid="mobile-more-trigger"]',
    ) as HTMLButtonElement;
    moreTrigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const logoutButton = fixture.nativeElement.querySelector(
      '.mobile-logout-btn',
    ) as HTMLButtonElement;
    logoutButton.click();
    await fixture.whenStable();

    expect(authService.logout).toHaveBeenCalledTimes(1);
    expect(notifications.info).toHaveBeenCalledWith('Signed out');
    expect(navigateSpy).toHaveBeenCalledWith('/login');
  });

  it('renders a runtime Whisparr outage warning with a Settings repair action', async () => {
    const { fixture } = await renderComponent({
      setupStatus: buildSetupStatus(),
      runtimeHealth: buildRuntimeHealth({
        degraded: true,
        services: {
          ...buildRuntimeHealth().services,
          whisparr: {
            service: 'WHISPARR',
            status: 'DEGRADED',
            degraded: true,
            consecutiveFailures: 2,
            lastHealthyAt: '2026-04-02T00:00:00.000Z',
            lastFailureAt: '2026-04-02T00:01:00.000Z',
            lastErrorMessage: 'Failed to reach Whisparr provider endpoint.',
            degradedAt: '2026-04-02T00:01:00.000Z',
          },
        },
      }),
    });

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="degraded-banner"]',
    ) as HTMLElement | null;
    const repairLink = fixture.nativeElement.querySelector(
      '[data-testid="repair-integrations-link"]',
    ) as HTMLAnchorElement | null;
    const settingsIndicator = fixture.nativeElement.querySelector(
      '[data-testid="settings-nav-indicator"]',
    ) as HTMLElement | null;

    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('Runtime outage');
    expect(banner?.textContent).toContain('Whisparr is currently unavailable.');
    expect(banner?.textContent).toContain('Acquisition and status updates may be stale.');
    expect(repairLink?.getAttribute('href')).toContain('/settings/integrations');
    expect(settingsIndicator?.textContent).toContain('Repair');
  });

  it('renders a runtime Stash outage warning', async () => {
    const { fixture } = await renderComponent({
      setupStatus: buildSetupStatus(),
      runtimeHealth: buildRuntimeHealth({
        degraded: true,
        services: {
          ...buildRuntimeHealth().services,
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
    });

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="degraded-banner"]',
    ) as HTMLElement | null;

    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('Stash is currently unavailable.');
    expect(banner?.textContent).toContain('Library and availability data may be degraded.');
  });

  it('clears a runtime outage warning when shared runtime health recovers', async () => {
    const { fixture, setRuntimeHealth } = await renderComponent({
      setupStatus: buildSetupStatus(),
      runtimeHealth: buildRuntimeHealth({
        degraded: true,
        services: {
          ...buildRuntimeHealth().services,
          whisparr: {
            service: 'WHISPARR',
            status: 'DEGRADED',
            degraded: true,
            consecutiveFailures: 2,
            lastHealthyAt: '2026-04-02T00:00:00.000Z',
            lastFailureAt: '2026-04-02T00:01:00.000Z',
            lastErrorMessage: 'Failed to reach Whisparr provider endpoint.',
            degradedAt: '2026-04-02T00:01:00.000Z',
          },
        },
      }),
    });

    expect(fixture.nativeElement.querySelector('[data-testid="degraded-banner"]')).toBeTruthy();

    setRuntimeHealth(buildRuntimeHealth());
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="degraded-banner"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="settings-nav-indicator"]'),
    ).toBeNull();
  });

  it('keeps setup degradation messaging ahead of runtime outage messaging', async () => {
    const { fixture } = await renderComponent({
      setupStatus: buildSetupStatus({
        setupComplete: false,
        required: {
          stash: true,
          catalog: true,
          whisparr: false,
        },
      }),
      runtimeHealth: buildRuntimeHealth({
        degraded: true,
        services: {
          ...buildRuntimeHealth().services,
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
    });

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="degraded-banner"]',
    ) as HTMLElement | null;

    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('Repair needed');
    expect(banner?.textContent).toContain('Whisparr needs repair.');
    expect(banner?.textContent).not.toContain('Stash is currently unavailable.');
  });
});
