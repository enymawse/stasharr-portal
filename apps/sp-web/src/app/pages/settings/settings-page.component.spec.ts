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

  async function renderPage(integrations: IntegrationResponse[]) {
    const integrationsService = {
      getIntegrations: vi.fn().mockReturnValue(of(integrations)),
      updateIntegration: vi.fn(),
      testIntegration: vi.fn(),
      resetIntegration: vi.fn(),
      resetAllIntegrations: vi.fn(),
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

  it('does not mark an unconfigured FansDB tab as active when StashDB is configured', async () => {
    const { component } = await renderPage([
      buildIntegration({ type: 'STASH' }),
      buildIntegration({ type: 'WHISPARR' }),
      buildIntegration({ type: 'STASHDB', enabled: true, baseUrl: 'http://stashdb.local/graphql' }),
    ]);

    expect(component.forms['FANSDB'].controls.enabled.value).toBe(false);
    expect(component.isActiveCatalogProvider('STASHDB')).toBe(true);
    expect(component.isActiveCatalogProvider('FANSDB')).toBe(false);
    expect(component.catalogProviderHelp('FANSDB')).toBe(
      'Configure FansDB, enable it, and save to make it the active discovery source.',
    );
  });

  it('tells the user to finish configuring FansDB when they enable it before saving', async () => {
    const { component } = await renderPage([
      buildIntegration({ type: 'STASH' }),
      buildIntegration({ type: 'WHISPARR' }),
      buildIntegration({ type: 'STASHDB', enabled: true, baseUrl: 'http://stashdb.local/graphql' }),
    ]);

    component.forms['FANSDB'].controls.enabled.setValue(true);

    expect(component.catalogProviderHelp('FANSDB')).toBe(
      'Finish configuring FansDB and save to make it the active discovery source.',
    );
  });
});
