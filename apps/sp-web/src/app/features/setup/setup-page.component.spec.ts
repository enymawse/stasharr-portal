import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
  const status = overrides.status ?? 'CONFIGURED';
  return {
    type: overrides.type,
    enabled: overrides.enabled ?? true,
    status,
    name: 'name' in overrides ? overrides.name ?? null : null,
    baseUrl: 'baseUrl' in overrides ? overrides.baseUrl ?? null : 'http://service.local',
    hasApiKey: overrides.hasApiKey ?? true,
    lastHealthyAt:
      'lastHealthyAt' in overrides
        ? overrides.lastHealthyAt ?? null
        : status === 'CONFIGURED'
          ? '2026-04-01T00:00:00.000Z'
          : null,
    lastErrorAt: 'lastErrorAt' in overrides ? overrides.lastErrorAt ?? null : null,
    lastErrorMessage:
      'lastErrorMessage' in overrides ? overrides.lastErrorMessage ?? null : null,
  };
}

function textContent(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
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
      testIntegration: vi.fn(),
      resetIntegration: vi.fn(),
    };
    const notifications = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
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
          useValue: notifications,
        },
      ],
    }).compileComponents();

    const router = TestBed.inject(Router);
    const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const fixture = TestBed.createComponent(SetupPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance as any,
      integrationsService,
      setupService,
      notifications,
      navigateByUrl,
    };
  }

  function checklistItemByTitle(
    fixture: { nativeElement: HTMLElement },
    title: string,
  ): HTMLElement {
    const items = Array.from(
      fixture.nativeElement.querySelectorAll('.checklist-item') as NodeListOf<HTMLElement>,
    );
    const item = items.find((candidate) => textContent(candidate.querySelector('h3')) === title);
    expect(item).toBeTruthy();
    return item as HTMLElement;
  }

  function cardByTitle(fixture: { nativeElement: HTMLElement }, title: string): HTMLElement {
    const cards = Array.from(
      fixture.nativeElement.querySelectorAll('.card') as NodeListOf<HTMLElement>,
    );
    const card = cards.find((candidate) => textContent(candidate.querySelector('h2')) === title);
    expect(card).toBeTruthy();
    return card as HTMLElement;
  }

  it('shows checklist progress and Save & Test guidance before a provider is chosen', async () => {
    const { fixture, component } = await renderPage(
      {
        setupComplete: false,
        required: { stash: false, catalog: false, whisparr: false },
        catalogProvider: null,
      },
      [
        buildIntegration({
          type: 'STASH',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
          hasApiKey: false,
        }),
        buildIntegration({
          type: 'WHISPARR',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
          hasApiKey: false,
        }),
        buildIntegration({
          type: 'STASHDB',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
          enabled: false,
          hasApiKey: false,
        }),
        buildIntegration({
          type: 'FANSDB',
          status: 'NOT_CONFIGURED',
          baseUrl: null,
          enabled: false,
          hasApiKey: false,
        }),
      ],
    );

    expect(component.visibleCatalogProviderTypes()).toEqual(['STASHDB', 'FANSDB']);
    expect(textContent(fixture.nativeElement.querySelector('.setup-overview'))).toContain(
      '0 of 3 required services ready',
    );
    expect(textContent(fixture.nativeElement.querySelector('.setup-overview'))).toContain(
      'Next step: choose a catalog provider and run Save & Test.',
    );

    const catalogChecklist = checklistItemByTitle(fixture, 'Catalog provider');
    expect(textContent(catalogChecklist)).toContain('Not Saved');
    expect(textContent(catalogChecklist)).toContain(
      'Choose StashDB or FansDB, then Save & Test the one you want to lock in.',
    );

    const stashCard = cardByTitle(fixture, 'Stash');
    expect(textContent(stashCard)).toContain('Not Saved');
    expect(textContent(stashCard)).toContain(
      'Enter Stash connection details, then Save & Test to continue setup.',
    );
    expect(textContent(stashCard)).toContain('Save & Test');
    expect(textContent(stashCard)).toContain('Save only');
  });

  it('renders Saved, Test Failed, and Ready states clearly in the checklist and cards', async () => {
    const { fixture } = await renderPage(
      {
        setupComplete: false,
        required: { stash: false, catalog: false, whisparr: true },
        catalogProvider: 'STASHDB',
      },
      [
        buildIntegration({
          type: 'STASH',
          status: 'ERROR',
          baseUrl: 'http://stash.local',
          lastHealthyAt: null,
          lastErrorAt: '2026-04-01T01:00:00.000Z',
          lastErrorMessage: 'bad credentials',
        }),
        buildIntegration({
          type: 'WHISPARR',
          baseUrl: 'http://whisparr.local',
          lastHealthyAt: '2026-04-01T02:00:00.000Z',
        }),
        buildIntegration({
          type: 'STASHDB',
          status: 'NOT_CONFIGURED',
          baseUrl: 'http://stashdb.local/graphql',
          lastHealthyAt: null,
        }),
      ],
    );

    expect(textContent(fixture.nativeElement.querySelector('.setup-overview'))).toContain(
      '1 of 3 required services ready',
    );

    expect(textContent(checklistItemByTitle(fixture, 'Catalog provider'))).toContain('Saved');
    expect(textContent(checklistItemByTitle(fixture, 'Stash'))).toContain('Test Failed');
    expect(textContent(checklistItemByTitle(fixture, 'Whisparr'))).toContain('Ready');

    const catalogCard = cardByTitle(fixture, 'StashDB');
    expect(textContent(catalogCard)).toContain('Saved');
    expect(textContent(catalogCard)).toContain(
      'StashDB is chosen and locked for this instance, but it still needs a successful test before setup can continue.',
    );

    const stashCard = cardByTitle(fixture, 'Stash');
    expect(textContent(stashCard)).toContain('Test Failed');
    expect(textContent(stashCard)).toContain('bad credentials');

    const whisparrCard = cardByTitle(fixture, 'Whisparr');
    expect(textContent(whisparrCard)).toContain('Ready');
    expect(textContent(whisparrCard)).toContain('Whisparr is connected and ready.');
  });

  it('keeps the chosen provider locked and separates repair from reset guidance', async () => {
    const { fixture, component } = await renderPage(
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
          lastHealthyAt: null,
          lastErrorMessage: 'forbidden',
        }),
      ],
    );

    expect(component.visibleCatalogProviderTypes()).toEqual(['FANSDB']);
    expect(textContent(fixture.nativeElement.querySelector('.setup-overview'))).toContain(
      'Next step: repair FansDB and run Save & Test again. Reset catalog setup only if you need a different provider.',
    );

    const catalogCard = cardByTitle(fixture, 'FansDB');
    expect(textContent(catalogCard)).toContain('Test Failed');
    expect(textContent(catalogCard)).toContain(
      'FansDB is still the chosen catalog provider. Repair the connection details and Save & Test again, or reset catalog setup to switch providers.',
    );
    expect(textContent(catalogCard)).toContain(
      'Reset catalog setup only if you need to switch providers.',
    );
    expect(textContent(catalogCard)).toContain('Reset catalog setup');
  });

  it('uses Save & Test as the primary guided action for required integrations', async () => {
    const initialStatus: SetupStatusResponse = {
      setupComplete: false,
      required: { stash: true, catalog: true, whisparr: false },
      catalogProvider: 'STASHDB',
    };
    const initialIntegrations = [
      buildIntegration({ type: 'STASH' }),
      buildIntegration({
        type: 'WHISPARR',
        status: 'NOT_CONFIGURED',
        baseUrl: null,
        hasApiKey: false,
        lastHealthyAt: null,
      }),
      buildIntegration({
        type: 'STASHDB',
        baseUrl: 'http://stashdb.local/graphql',
      }),
    ];

    const { fixture, component, integrationsService, setupService, notifications, navigateByUrl } =
      await renderPage(initialStatus, initialIntegrations);

    const savedIntegration = buildIntegration({
      type: 'WHISPARR',
      status: 'NOT_CONFIGURED',
      name: 'Remote Whisparr',
      baseUrl: 'http://whisparr.local',
      hasApiKey: true,
      lastHealthyAt: null,
    });
    const testedIntegration = buildIntegration({
      type: 'WHISPARR',
      status: 'CONFIGURED',
      name: 'Remote Whisparr',
      baseUrl: 'http://whisparr.local',
      hasApiKey: true,
      lastHealthyAt: '2026-04-01T03:00:00.000Z',
    });

    integrationsService.updateIntegration.mockReturnValue(of(savedIntegration));
    integrationsService.testIntegration.mockReturnValue(of(testedIntegration));
    integrationsService.getIntegrations.mockReturnValueOnce(
      of([
        buildIntegration({ type: 'STASH' }),
        testedIntegration,
        buildIntegration({
          type: 'STASHDB',
          baseUrl: 'http://stashdb.local/graphql',
        }),
      ]),
    );
    setupService.getStatus.mockReturnValueOnce(
      of({
        setupComplete: true,
        required: { stash: true, catalog: true, whisparr: true },
        catalogProvider: 'STASHDB',
      }),
    );

    component.formFor('WHISPARR').setValue({
      name: 'Remote Whisparr',
      baseUrl: 'http://whisparr.local',
      apiKey: 'token-123',
      enabled: true,
    });

    const whisparrCard = cardByTitle(fixture, 'Whisparr');
    const saveAndTestButton = Array.from(
      whisparrCard.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => textContent(button) === 'Save & Test');
    expect(saveAndTestButton).toBeTruthy();

    saveAndTestButton?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(integrationsService.updateIntegration).toHaveBeenCalledWith('WHISPARR', {
      enabled: true,
      name: 'Remote Whisparr',
      baseUrl: 'http://whisparr.local',
      apiKey: 'token-123',
    });
    expect(integrationsService.testIntegration).toHaveBeenCalledWith('WHISPARR', {
      enabled: true,
      name: 'Remote Whisparr',
      baseUrl: 'http://whisparr.local',
      apiKey: 'token-123',
    });
    expect(notifications.success).toHaveBeenCalledWith('Whisparr is ready.');
    expect(textContent(cardByTitle(fixture, 'Whisparr'))).toContain('Whisparr is ready.');
    expect(navigateByUrl).toHaveBeenCalledWith('/scenes');
  });
});
