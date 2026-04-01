import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of } from 'rxjs';
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
  const status = overrides.status ?? 'CONFIGURED';
  return {
    type: overrides.type,
    enabled: overrides.enabled ?? true,
    status,
    name: 'name' in overrides ? (overrides.name ?? null) : null,
    baseUrl: 'baseUrl' in overrides ? (overrides.baseUrl ?? null) : 'http://service.local',
    hasApiKey: overrides.hasApiKey ?? true,
    lastHealthyAt:
      'lastHealthyAt' in overrides
        ? (overrides.lastHealthyAt ?? null)
        : status === 'CONFIGURED'
          ? '2026-04-01T00:00:00.000Z'
          : null,
    lastErrorAt: 'lastErrorAt' in overrides ? (overrides.lastErrorAt ?? null) : null,
    lastErrorMessage: 'lastErrorMessage' in overrides ? (overrides.lastErrorMessage ?? null) : null,
  };
}

function textContent(element: Element | null): string {
  return element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function buildSettingsIntegrations(): IntegrationResponse[] {
  return [
    buildIntegration({ type: 'STASH' }),
    buildIntegration({ type: 'WHISPARR' }),
    buildIntegration({
      type: 'STASHDB',
      enabled: true,
      baseUrl: 'http://stashdb.local/graphql',
    }),
  ];
}

function buildSettingsSetupStatus(): SetupStatusResponse {
  return {
    setupComplete: true,
    required: { stash: true, catalog: true, whisparr: true },
    catalogProvider: 'STASHDB',
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
    const notifications = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };
    const confirmationService = {
      confirm: vi.fn(),
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
          useValue: confirmationService,
        },
        {
          provide: AppNotificationsService,
          useValue: notifications,
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(SettingsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance as any,
      integrationsService,
      setupService,
      notifications,
      confirmationService,
    };
  }

  function overview(fixture: { nativeElement: HTMLElement }): HTMLElement {
    const element = fixture.nativeElement.querySelector('.settings-overview') as HTMLElement | null;
    expect(element).toBeTruthy();
    return element as HTMLElement;
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

  function panelByTitle(fixture: { nativeElement: HTMLElement }, title: string): HTMLElement {
    const panels = Array.from(
      fixture.nativeElement.querySelectorAll('.service-panel') as NodeListOf<HTMLElement>,
    );
    const panel = panels.find((candidate) => textContent(candidate.querySelector('h2')) === title);
    expect(panel).toBeTruthy();
    return panel as HTMLElement;
  }

  function integrationResetButton(panel: HTMLElement): HTMLButtonElement {
    const button = panel.querySelector('.danger-card button') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  function integrationActionButtons(panel: HTMLElement): HTMLButtonElement[] {
    const buttons = Array.from(
      panel.querySelectorAll('.actions button') as NodeListOf<HTMLButtonElement>,
    );
    expect(buttons).toHaveLength(2);
    return buttons;
  }

  function globalResetButton(fixture: { nativeElement: HTMLElement }): HTMLButtonElement {
    const button = fixture.nativeElement.querySelector(
      '.global-danger button',
    ) as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    return button as HTMLButtonElement;
  }

  it('shows the top-level readiness summary and checklist when all required services are ready', async () => {
    const { fixture, component } = await renderPage(
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
          status: 'NOT_CONFIGURED',
          enabled: false,
          baseUrl: null,
          hasApiKey: false,
          lastHealthyAt: null,
        }),
      ],
      {
        setupComplete: true,
        required: { stash: true, catalog: true, whisparr: true },
        catalogProvider: 'STASHDB',
      },
    );

    expect(component.serviceTabs()).toEqual(['STASH', 'WHISPARR', 'STASHDB']);
    expect(textContent(overview(fixture))).toContain('3 of 3 required services ready');
    expect(textContent(overview(fixture))).toContain(
      'Every required service has passed readiness checks.',
    );
    expect(textContent(overview(fixture))).toContain('Catalog provider: StashDB');
    expect(textContent(checklistItemByTitle(fixture, 'Catalog provider'))).toContain('Ready');
    expect(textContent(checklistItemByTitle(fixture, 'Catalog provider'))).toContain(
      'StashDB chosen and ready.',
    );
    expect(component.catalogProviderHelp('STASHDB')).toBe(
      'StashDB is the catalog provider configured for this Stasharr instance. Reset catalog setup before changing provider type.',
    );
    expect(component.showEnabledToggle('STASHDB')).toBe(false);
  });

  it('shows a repair summary and readiness checklist state when a required integration is unhealthy', async () => {
    const { fixture, component } = await renderPage(
      [
        buildIntegration({ type: 'STASH' }),
        buildIntegration({
          type: 'WHISPARR',
          status: 'ERROR',
          baseUrl: 'http://whisparr.local',
          lastHealthyAt: null,
          lastErrorAt: '2026-04-01T01:00:00.000Z',
          lastErrorMessage: 'bad credentials',
        }),
        buildIntegration({
          type: 'STASHDB',
          enabled: true,
          baseUrl: 'http://stashdb.local/graphql',
        }),
      ],
      {
        setupComplete: false,
        required: { stash: true, catalog: true, whisparr: false },
        catalogProvider: 'STASHDB',
      },
    );

    expect(textContent(overview(fixture))).toContain('2 of 3 required services ready');
    expect(textContent(overview(fixture))).toContain('Whisparr needs repair.');
    expect(textContent(overview(fixture))).toContain(
      'Repair needed: Whisparr needs repair. Use Save & Test on the affected integration below.',
    );

    const whisparrChecklist = checklistItemByTitle(fixture, 'Whisparr');
    expect(textContent(whisparrChecklist)).toContain('Test Failed');
    expect(textContent(whisparrChecklist)).toContain('Whisparr needs repair.');

    const panel = panelByTitle(fixture, 'Whisparr');
    expect(textContent(panel)).toContain('Test Failed');
    expect(textContent(panel)).toContain(
      'Repair Whisparr connection details if needed, then Save & Test again to restore readiness.',
    );
    expect(textContent(panel)).toContain('bad credentials');
  });

  it('keeps the chosen catalog provider locked and separates repair from reset guidance', async () => {
    const { fixture, component } = await renderPage(
      [
        buildIntegration({ type: 'STASH' }),
        buildIntegration({ type: 'WHISPARR' }),
        buildIntegration({
          type: 'FANSDB',
          status: 'ERROR',
          enabled: true,
          baseUrl: 'http://fansdb.local/graphql',
          lastHealthyAt: null,
          lastErrorMessage: 'forbidden',
        }),
        buildIntegration({
          type: 'STASHDB',
          status: 'NOT_CONFIGURED',
          enabled: false,
          baseUrl: null,
          hasApiKey: false,
          lastHealthyAt: null,
        }),
      ],
      {
        setupComplete: false,
        required: { stash: true, catalog: false, whisparr: true },
        catalogProvider: 'FANSDB',
      },
    );

    expect(component.serviceTabs()).toEqual(['STASH', 'WHISPARR', 'FANSDB']);
    expect(textContent(overview(fixture))).toContain('FansDB needs repair.');
    expect(textContent(overview(fixture))).toContain(
      'Catalog provider: FansDB. It stays locked to this instance even while unhealthy.',
    );

    const panel = panelByTitle(fixture, 'FansDB');
    expect(textContent(panel)).toContain('Test Failed');
    expect(textContent(panel)).toContain(
      "FansDB remains this instance's catalog provider even while unhealthy. Repair it here and Save & Test again. Reset catalog setup only if you need to switch providers.",
    );
    expect(textContent(panel)).toContain('Reset FansDB Integration');
  });

  it('hides catalog tabs when no provider is configured and points the user back to setup', async () => {
    const { fixture, component } = await renderPage(
      [
        buildIntegration({ type: 'STASH' }),
        buildIntegration({ type: 'WHISPARR' }),
        buildIntegration({
          type: 'STASHDB',
          status: 'NOT_CONFIGURED',
          enabled: false,
          baseUrl: null,
          hasApiKey: false,
          lastHealthyAt: null,
        }),
        buildIntegration({
          type: 'FANSDB',
          status: 'NOT_CONFIGURED',
          enabled: false,
          baseUrl: null,
          hasApiKey: false,
          lastHealthyAt: null,
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
    expect(textContent(overview(fixture))).toContain('Catalog provider: Not chosen');
    expect(textContent(overview(fixture))).toContain('Primary repair path: Save & Test');
    expect(textContent(overview(fixture))).toContain(
      'Catalog provider: not chosen. Return to setup to lock StashDB or FansDB for this instance.',
    );
    expect(textContent(checklistItemByTitle(fixture, 'Catalog provider'))).toContain('Not Saved');
  });

  it('uses Save & Test as the primary repair action in Settings', async () => {
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
    const { fixture, component, integrationsService, setupService, notifications } =
      await renderPage(initialIntegrations, {
        setupComplete: false,
        required: { stash: true, catalog: true, whisparr: false },
        catalogProvider: 'STASHDB',
      });

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

    const panel = panelByTitle(fixture, 'Whisparr');
    const buttons = Array.from(panel.querySelectorAll('button') as NodeListOf<HTMLButtonElement>);
    expect(buttons.map((button) => textContent(button)).slice(0, 2)).toEqual([
      'Save & Test',
      'Save only',
    ]);

    const saveAndTestButton = buttons.find((button) => textContent(button) === 'Save & Test');
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
    expect(textContent(panelByTitle(fixture, 'Whisparr'))).toContain('Ready');
    expect(textContent(panelByTitle(fixture, 'Whisparr'))).toContain('Whisparr is ready.');
  });

  it('serializes page mutations while save is running on another integration, then re-enables actions', async () => {
    const { fixture, component, integrationsService, confirmationService } = await renderPage(
      buildSettingsIntegrations(),
      buildSettingsSetupStatus(),
    );

    const saveSubject = new Subject<IntegrationResponse>();
    integrationsService.updateIntegration.mockReturnValue(saveSubject);

    component.formFor('WHISPARR').setValue({
      name: 'Remote Whisparr',
      baseUrl: 'http://whisparr.local',
      apiKey: 'token-123',
      enabled: true,
    });

    component.saveIntegration('WHISPARR');
    fixture.detectChanges();

    const whisparrPanel = panelByTitle(fixture, 'Whisparr');
    const stashPanel = panelByTitle(fixture, 'Stash');

    expect(textContent(integrationActionButtons(whisparrPanel)[1])).toBe('Saving...');
    expect(integrationActionButtons(stashPanel).map((button) => button.disabled)).toEqual([
      true,
      true,
    ]);
    expect(integrationResetButton(stashPanel).disabled).toBe(true);
    expect(globalResetButton(fixture).disabled).toBe(true);

    component.saveIntegration('STASH');
    component.saveAndTestIntegration('STASH');
    component.resetIntegration('STASH');
    component.requestIntegrationReset('STASH');
    component.requestResetAll();
    component.resetAllIntegrations();

    expect(integrationsService.updateIntegration).toHaveBeenCalledTimes(1);
    expect(integrationsService.testIntegration).not.toHaveBeenCalled();
    expect(integrationsService.resetIntegration).not.toHaveBeenCalled();
    expect(integrationsService.resetAllIntegrations).not.toHaveBeenCalled();
    expect(confirmationService.confirm).not.toHaveBeenCalled();

    saveSubject.next(
      buildIntegration({
        type: 'WHISPARR',
        name: 'Remote Whisparr',
        baseUrl: 'http://whisparr.local',
        hasApiKey: true,
      }),
    );
    saveSubject.complete();

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      integrationActionButtons(panelByTitle(fixture, 'Stash')).map((button) => button.disabled),
    ).toEqual([false, false]);
    expect(integrationResetButton(panelByTitle(fixture, 'Stash')).disabled).toBe(false);
    expect(globalResetButton(fixture).disabled).toBe(false);
  });

  it('serializes page mutations while Save & Test is running on another integration', async () => {
    const { fixture, component, integrationsService, confirmationService } = await renderPage(
      buildSettingsIntegrations(),
      buildSettingsSetupStatus(),
    );

    const updateSubject = new Subject<IntegrationResponse>();
    integrationsService.updateIntegration.mockReturnValue(updateSubject);
    integrationsService.testIntegration.mockReturnValue(
      of(
        buildIntegration({
          type: 'WHISPARR',
          name: 'Remote Whisparr',
          baseUrl: 'http://whisparr.local',
          hasApiKey: true,
        }),
      ),
    );

    component.formFor('WHISPARR').setValue({
      name: 'Remote Whisparr',
      baseUrl: 'http://whisparr.local',
      apiKey: 'token-123',
      enabled: true,
    });

    component.saveAndTestIntegration('WHISPARR');
    fixture.detectChanges();

    const whisparrPanel = panelByTitle(fixture, 'Whisparr');
    const stashPanel = panelByTitle(fixture, 'Stash');

    expect(textContent(integrationActionButtons(whisparrPanel)[0])).toBe('Saving & testing...');
    expect(integrationActionButtons(stashPanel).map((button) => button.disabled)).toEqual([
      true,
      true,
    ]);
    expect(integrationResetButton(stashPanel).disabled).toBe(true);
    expect(globalResetButton(fixture).disabled).toBe(true);

    component.requestIntegrationReset('STASH');
    component.requestResetAll();
    expect(confirmationService.confirm).not.toHaveBeenCalled();

    updateSubject.next(
      buildIntegration({
        type: 'WHISPARR',
        status: 'NOT_CONFIGURED',
        name: 'Remote Whisparr',
        baseUrl: 'http://whisparr.local',
        hasApiKey: true,
        lastHealthyAt: null,
      }),
    );
    updateSubject.complete();

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      integrationActionButtons(panelByTitle(fixture, 'Stash')).map((button) => button.disabled),
    ).toEqual([false, false]);
    expect(integrationResetButton(panelByTitle(fixture, 'Stash')).disabled).toBe(false);
    expect(globalResetButton(fixture).disabled).toBe(false);
  });

  it('shows a resetting state and serializes other panels while reset is running', async () => {
    const { fixture, component, integrationsService, confirmationService } = await renderPage(
      buildSettingsIntegrations(),
      buildSettingsSetupStatus(),
    );

    const resetSubject = new Subject<void>();
    integrationsService.resetIntegration.mockReturnValue(resetSubject);

    component.resetIntegration('WHISPARR');
    fixture.detectChanges();

    const whisparrPanel = panelByTitle(fixture, 'Whisparr');
    const stashPanel = panelByTitle(fixture, 'Stash');

    expect(integrationActionButtons(whisparrPanel).map((button) => button.disabled)).toEqual([
      true,
      true,
    ]);
    expect(textContent(integrationResetButton(whisparrPanel))).toBe('Resetting...');
    expect(integrationResetButton(whisparrPanel).disabled).toBe(true);
    expect(integrationActionButtons(stashPanel).map((button) => button.disabled)).toEqual([
      true,
      true,
    ]);
    expect(integrationResetButton(stashPanel).disabled).toBe(true);
    expect(globalResetButton(fixture).disabled).toBe(true);

    component.saveIntegration('STASH');
    component.saveAndTestIntegration('STASH');
    component.requestIntegrationReset('STASH');
    component.requestResetAll();
    component.resetAllIntegrations();

    expect(integrationsService.updateIntegration).not.toHaveBeenCalled();
    expect(integrationsService.testIntegration).not.toHaveBeenCalled();
    expect(integrationsService.resetAllIntegrations).not.toHaveBeenCalled();
    expect(confirmationService.confirm).not.toHaveBeenCalled();

    resetSubject.next();
    resetSubject.complete();

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      integrationActionButtons(panelByTitle(fixture, 'Stash')).map((button) => button.disabled),
    ).toEqual([false, false]);
    expect(integrationResetButton(panelByTitle(fixture, 'Stash')).disabled).toBe(false);
    expect(globalResetButton(fixture).disabled).toBe(false);
    expect(textContent(integrationResetButton(panelByTitle(fixture, 'Whisparr')))).toBe(
      'Reset Whisparr Integration',
    );
  });
});
