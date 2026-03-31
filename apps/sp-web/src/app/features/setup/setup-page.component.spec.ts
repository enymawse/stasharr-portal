import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsService } from '../../core/api/integrations.service';
import { IntegrationResponse } from '../../core/api/integrations.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { SetupPageComponent } from './setup-page.component';

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

describe('SetupPageComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  async function renderPage(status: SetupStatusResponse, integrations: IntegrationResponse[]) {
    const setupService = {
      getStatus: vi.fn().mockReturnValue(of(status)),
    };
    const integrationsService = {
      getIntegrations: vi.fn().mockReturnValue(of(integrations)),
      updateIntegration: vi.fn(),
      resetIntegration: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SetupPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: SetupService,
          useValue: setupService,
        },
        {
          provide: IntegrationsService,
          useValue: integrationsService,
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

    const fixture = TestBed.createComponent(SetupPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance as any };
  }

  it('frames setup as choosing the instance catalog provider before setup is complete', async () => {
    const { component } = await renderPage(
      {
        setupComplete: false,
        required: { stash: false, catalog: false, whisparr: false },
        catalogProvider: null,
      },
      [
        buildIntegration({ type: 'STASH', status: 'NOT_CONFIGURED', baseUrl: null }),
        buildIntegration({
          type: 'WHISPARR',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
        }),
        buildIntegration({
          type: 'STASHDB',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
          enabled: false,
        }),
        buildIntegration({
          type: 'FANSDB',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
          enabled: false,
        }),
      ],
    );

    expect(component.visibleCatalogProviderTypes()).toEqual(['STASHDB', 'FANSDB']);
    expect(component.setupSummary()).toBe(
      'Setup in progress: choose the catalog provider for this Stasharr instance, then configure Stash and Whisparr.',
    );
    expect(component.catalogProviderHelp('FANSDB')).toBe(
      'Choose FansDB for this Stasharr instance. Changing provider type later requires resetting catalog setup and running setup again.',
    );
    expect(component.showEnabledToggle('FANSDB')).toBe(false);
  });

  it('locks setup to the chosen catalog provider and offers reset guidance', async () => {
    const { component } = await renderPage(
      {
        setupComplete: false,
        required: { stash: true, catalog: true, whisparr: false },
        catalogProvider: 'FANSDB',
      },
      [
        buildIntegration({ type: 'STASH' }),
        buildIntegration({
          type: 'WHISPARR',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
        }),
        buildIntegration({
          type: 'FANSDB',
          baseUrl: 'http://fansdb.local/graphql',
        }),
      ],
    );

    expect(component.visibleCatalogProviderTypes()).toEqual(['FANSDB']);
    expect(component.setupSummary()).toBe(
      'Setup in progress: this Stasharr instance is configured for FansDB. Finish Stash and Whisparr, or reset catalog setup to choose a different provider.',
    );
    expect(component.catalogProviderHelp('FANSDB')).toBe(
      "FansDB is locked in as this instance's catalog provider. /scenes, performers, studios, requests, and indexing will use it.",
    );
  });

  it('keeps setup locked to the chosen provider when it is unhealthy', async () => {
    const { component } = await renderPage(
      {
        setupComplete: false,
        required: { stash: true, catalog: false, whisparr: true },
        catalogProvider: 'FANSDB',
      },
      [
        buildIntegration({ type: 'STASH' }),
        buildIntegration({ type: 'WHISPARR' }),
        buildIntegration({
          type: 'FANSDB',
          status: 'ERROR',
          baseUrl: 'http://fansdb.local/graphql',
          lastErrorMessage: 'bad credentials',
        }),
      ],
    );

    expect(component.visibleCatalogProviderTypes()).toEqual(['FANSDB']);
    expect(component.setupSummary()).toBe(
      'Setup in progress: this Stasharr instance is locked to FansDB, but that catalog integration needs repair before setup can finish. Repair it below or reset catalog setup to choose a different provider.',
    );
    expect(component.catalogProviderHelp('FANSDB')).toBe(
      "FansDB remains locked in as this instance's catalog provider even while unhealthy. Repair it below or reset catalog setup before choosing a different provider.",
    );
  });
});
