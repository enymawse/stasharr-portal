import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { AppShellLayoutComponent } from './app-shell-layout.component';

describe('AppShellLayoutComponent', () => {
  function buildSetupStatus(
    overrides: Partial<SetupStatusResponse> = {},
  ): SetupStatusResponse {
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

  async function renderComponent(setupStatus = buildSetupStatus()) {
    const setupService = {
      getStatus: vi.fn().mockReturnValue(of(setupStatus)),
    };

    await TestBed.configureTestingModule({
      imports: [AppShellLayoutComponent],
      providers: [
        provideRouter([]),
        {
          provide: SetupService,
          useValue: setupService,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AppShellLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, setupService };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the consolidated primary navigation labels without a degraded warning when all required services are ready', async () => {
    const { fixture } = await renderComponent();
    const navLinks = Array.from(
      fixture.nativeElement.querySelectorAll('a.nav-item') as NodeListOf<HTMLAnchorElement>,
    );
    const navLabels = navLinks
      .map((link) => link.textContent?.replace(/\s+/g, ' ').trim())
      .filter((label): label is string => Boolean(label));

    expect(navLabels).toEqual([
      'Home',
      'Scenes',
      'Acquisition',
      'Library',
      'Performers',
      'Studios',
      'Settings',
    ]);
    expect(navLinks.find((link) => link.textContent?.includes('Scenes'))?.getAttribute('href')).toContain(
      '/scenes',
    );
    expect(fixture.nativeElement.querySelector('[data-testid="degraded-banner"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="settings-nav-indicator"]')).toBeNull();
  });

  it('renders a service-specific degraded warning with a Settings repair action', async () => {
    const { fixture } = await renderComponent(
      buildSetupStatus({
        setupComplete: false,
        required: {
          stash: true,
          catalog: true,
          whisparr: false,
        },
      }),
    );

    const banner = fixture.nativeElement.querySelector('[data-testid="degraded-banner"]') as HTMLElement | null;
    const repairLink = fixture.nativeElement.querySelector(
      '[data-testid="repair-integrations-link"]',
    ) as HTMLAnchorElement | null;
    const settingsIndicator = fixture.nativeElement.querySelector(
      '[data-testid="settings-nav-indicator"]',
    ) as HTMLElement | null;

    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('Whisparr needs repair.');
    expect(banner?.textContent).toContain('Acquisition and status updates may be stale.');
    expect(repairLink?.getAttribute('href')).toContain('/settings');
    expect(settingsIndicator?.textContent).toContain('Repair');
  });

  it('renders a combined degraded summary when multiple required integrations are unhealthy', async () => {
    const { fixture } = await renderComponent(
      buildSetupStatus({
        setupComplete: false,
        required: {
          stash: false,
          catalog: false,
          whisparr: true,
        },
        catalogProvider: 'FANSDB',
      }),
    );

    const banner = fixture.nativeElement.querySelector('[data-testid="degraded-banner"]') as HTMLElement | null;
    const settingsLink = fixture.nativeElement.querySelector(
      '[data-testid="settings-nav-link"]',
    ) as HTMLAnchorElement | null;

    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('2 required integrations need repair.');
    expect(banner?.textContent).toContain('Some app data may be unavailable or stale.');
    expect(settingsLink?.classList.contains('has-alert')).toBe(true);
  });
});
