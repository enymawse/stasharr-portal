import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmationService } from 'primeng/api';
import { HealthService } from '../../core/api/health.service';
import { HealthStatusResponse } from '../../core/api/health.types';
import { IntegrationsService } from '../../core/api/integrations.service';
import { IntegrationResponse } from '../../core/api/integrations.types';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SettingsPageComponent } from './settings-page.component';

function buildHealthStatus(): HealthStatusResponse {
  return {
    status: 'ok',
    database: 'ok',
    service: 'sp-api',
    version: 'test',
  };
}

function buildIntegration(
  overrides: Partial<IntegrationResponse> & Pick<IntegrationResponse, 'type'>,
): IntegrationResponse {
  return {
    type: overrides.type,
    enabled: overrides.enabled ?? true,
    status: overrides.status ?? 'CONFIGURED',
    name: overrides.name ?? null,
    baseUrl: overrides.baseUrl ?? 'http://service.local',
    hasApiKey: overrides.hasApiKey ?? true,
    lastHealthyAt: overrides.lastHealthyAt ?? null,
    lastErrorAt: overrides.lastErrorAt ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
  };
}

describe('SettingsPageComponent', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverStub as typeof ResizeObserver;

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  async function renderPage(integrations: IntegrationResponse[], setupStatus: SetupStatusResponse) {
    const integrationsService = {
      getIntegrations: vi.fn().mockReturnValue(of(integrations)),
      updateIntegration: vi.fn(),
      testIntegration: vi.fn(),
      resetIntegration: vi.fn(),
      resetAllIntegrations: vi.fn(),
    };
    const setupService = {
      getStatus: vi.fn().mockReturnValue(of(setupStatus)),
    };
    const healthService = {
      getStatus: vi.fn().mockReturnValue(of(buildHealthStatus())),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: IntegrationsService,
          useValue: integrationsService,
        },
        {
          provide: SetupService,
          useValue: setupService,
        },
        {
          provide: HealthService,
          useValue: healthService,
        },
        {
          provide: ConfirmationService,
          useValue: {
            confirm: vi.fn(),
          },
        },
        {
          provide: AppNotificationsService,
          useValue: {
            success: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance as any };
  }

  it('shows only the configured catalog provider tab and reset guidance after setup', async () => {
    const { component } = await renderPage(
      [
        buildIntegration({ type: 'STASH' }),
        buildIntegration({ type: 'WHISPARR' }),
        buildIntegration({
          type: 'STASHDB',
          enabled: true,
          baseUrl: 'http://stashdb.local/graphql',
        }),
        buildIntegration({
          type: 'FANSDB',
          enabled: false,
          baseUrl: 'http://fansdb.local/graphql',
        }),
      ],
      {
        setupComplete: true,
        required: { stash: true, catalog: true, whisparr: true },
        catalogProvider: 'STASHDB',
      },
    );

    expect(component.serviceTabs()).toEqual(['STASH', 'WHISPARR', 'STASHDB']);
    expect(component.catalogProviderSummary()).toBe(
      'This Stasharr instance is configured for StashDB. To use a different catalog provider, reset catalog setup and re-run setup.',
    );
    expect(component.catalogProviderHelp('STASHDB')).toBe(
      'StashDB is the catalog provider configured for this Stasharr instance. Reset catalog setup before changing provider type.',
    );
    expect(component.showEnabledToggle('STASHDB')).toBe(false);
  });

  it('hides catalog tabs when no provider is configured and points the user back to setup', async () => {
    const { component } = await renderPage(
      [
        buildIntegration({ type: 'STASH' }),
        buildIntegration({ type: 'WHISPARR' }),
        buildIntegration({
          type: 'STASHDB',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
        }),
        buildIntegration({
          type: 'FANSDB',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
        }),
      ],
      {
        setupComplete: false,
        required: { stash: true, catalog: false, whisparr: true },
        catalogProvider: null,
      },
    );

    expect(component.serviceTabs()).toEqual(['STASH', 'WHISPARR']);
    expect(component.configuredCatalogProviderLabel()).toBeNull();
    expect(component.catalogProviderSummary()).toBe(
      'No catalog provider is configured right now. Return to setup to choose StashDB or FansDB for this instance.',
    );
  });

  it('keeps the chosen catalog provider tab visible when that provider is unhealthy', async () => {
    const { component } = await renderPage(
      [
        buildIntegration({ type: 'STASH' }),
        buildIntegration({ type: 'WHISPARR' }),
        buildIntegration({
          type: 'FANSDB',
          status: 'ERROR',
          baseUrl: 'http://fansdb.local/graphql',
          lastErrorMessage: 'bad credentials',
        }),
        buildIntegration({
          type: 'STASHDB',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
        }),
      ],
      {
        setupComplete: false,
        required: { stash: true, catalog: false, whisparr: true },
        catalogProvider: 'FANSDB',
      },
    );

    expect(component.serviceTabs()).toEqual(['STASH', 'WHISPARR', 'FANSDB']);
    expect(component.catalogProviderSummary()).toBe(
      'This Stasharr instance is locked to FansDB, but that catalog integration needs repair. Repair its settings below or reset catalog setup to choose a different provider.',
    );
    expect(component.catalogProviderHelp('FANSDB')).toBe(
      "FansDB remains this instance's catalog provider even while unhealthy. Repair it here, or reset catalog setup before changing provider type.",
    );
  });
});
