import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, finalize, forkJoin, map, switchMap } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
  CatalogProviderType,
  IntegrationResponse,
  IntegrationType,
  ReadinessState,
  hasSavedIntegrationConfig,
  integrationLabel,
  integrationReadinessState,
  isIntegrationReady,
  isCatalogProviderType,
} from '../../core/api/integrations.types';
import { IntegrationsService } from '../../core/api/integrations.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusResponse } from '../../core/api/setup.types';
import {
  IntegrationRepairPanelComponent,
  IntegrationRepairPanelMessage,
} from '../../shared/integration-repair-panel/integration-repair-panel.component';
import {
  IntegrationActionState,
  IntegrationForm,
  buildIntegrationPayload,
  createActionStateRecord,
  createEmptyIntegrationsRecord,
  createIntegrationForm,
  defaultEnabledValue,
  describeMutationError,
  formatOptionalDateTime,
  mapIntegrationsByType,
  patchActionState,
} from '../../shared/integration-repair/integration-repair.utils';
import {
  initialIndexingGuidance,
  setupCompleteSummary,
} from '../../shared/readiness/first-run-readiness.utils';

@Component({
  selector: 'app-setup-page',
  imports: [Message, ProgressSpinner, ButtonDirective, RouterLink, IntegrationRepairPanelComponent],
  templateUrl: './setup-page.component.html',
  styleUrl: './setup-page.component.scss',
})
export class SetupPageComponent implements OnInit {
  private readonly setupService = inject(SetupService);
  private readonly integrationsService = inject(IntegrationsService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly route = inject(ActivatedRoute);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly status = signal<SetupStatusResponse | null>(null);
  protected readonly resettingCatalogProvider = signal(false);
  protected readonly bootstrapHandoff = signal(false);

  private readonly allIntegrationTypes: IntegrationType[] = [
    'STASH',
    'WHISPARR',
    'STASHDB',
    'FANSDB',
  ];

  protected readonly requiredServiceTypes: IntegrationType[] = ['STASH', 'WHISPARR'];
  protected readonly catalogProviderTypes: CatalogProviderType[] = ['STASHDB', 'FANSDB'];
  protected readonly visibleCatalogProviderTypes = computed<CatalogProviderType[]>(() => {
    const catalogProvider = this.catalogProvider();
    return catalogProvider ? [catalogProvider] : this.catalogProviderTypes;
  });

  protected readonly forms: Record<IntegrationType, IntegrationForm> = {
    STASH: createIntegrationForm(),
    WHISPARR: createIntegrationForm(),
    STASHDB: createIntegrationForm(),
    FANSDB: createIntegrationForm(),
  };

  protected readonly integrations = signal<Record<IntegrationType, IntegrationResponse | null>>(
    createEmptyIntegrationsRecord(),
  );

  protected readonly saveState =
    signal<Record<IntegrationType, IntegrationActionState>>(createActionStateRecord());

  protected readonly testState =
    signal<Record<IntegrationType, IntegrationActionState>>(createActionStateRecord());

  protected readonly saveAndTestState =
    signal<Record<IntegrationType, IntegrationActionState>>(createActionStateRecord());

  protected readonly isSetupComplete = computed(() => this.status()?.setupComplete ?? false);
  protected readonly checklistItems = computed<SetupChecklistItem[]>(() => [
    this.catalogChecklistItem(),
    this.requiredChecklistItem('STASH'),
    this.requiredChecklistItem('WHISPARR'),
  ]);
  protected readonly readyCount = computed(
    () => this.checklistItems().filter((item) => item.ready).length,
  );
  protected readonly progressSummary = computed(
    () => `${this.readyCount()} of ${this.checklistItems().length} required services ready`,
  );

  ngOnInit(): void {
    this.bootstrapHandoff.set(this.route.snapshot.queryParamMap.get('from') === 'bootstrap');
    this.loadSetupData();
  }

  protected formFor(type: IntegrationType): IntegrationForm {
    return this.forms[type];
  }

  protected labelFor(type: IntegrationType): string {
    return integrationLabel(type);
  }

  protected isCatalogProvider(type: IntegrationType): boolean {
    return isCatalogProviderType(type);
  }

  protected showEnabledToggle(type: IntegrationType): boolean {
    return !this.isCatalogProvider(type);
  }

  protected catalogProvider(): CatalogProviderType | null {
    return this.status()?.catalogProvider ?? null;
  }

  protected catalogProviderReady(): boolean {
    return this.status()?.required.catalog ?? false;
  }

  protected setupLead(): string {
    if (this.isSetupComplete()) {
      return 'Every required service has passed readiness checks.';
    }

    return this.nextStepSummary();
  }

  protected setupSummary(): string {
    const catalogProvider = this.catalogProvider();
    if (this.isSetupComplete()) {
      return `This Stasharr instance uses ${catalogProvider ? this.labelFor(catalogProvider) : 'its catalog provider'} with Stash and Whisparr ready.`;
    }

    if (!catalogProvider) {
      return 'Choose the catalog provider for this Stasharr instance, then continue through the remaining required services.';
    }

    if (!this.catalogProviderReady()) {
      return `Catalog remains locked to ${this.labelFor(catalogProvider)} until it is healthy. Repair it below, or reset catalog setup only if you need a different provider.`;
    }

    return `${this.labelFor(catalogProvider)} is locked in as the catalog provider. Finish the remaining required services to complete setup.`;
  }

  protected setupCompleteSummary(): string {
    const catalogProvider = this.catalogProvider();
    return setupCompleteSummary(
      catalogProvider ? this.labelFor(catalogProvider) : 'The catalog provider',
    );
  }

  protected indexingGuidance(): string {
    return initialIndexingGuidance();
  }

  protected catalogProviderHelp(type: IntegrationType): string | null {
    if (!this.isCatalogProvider(type)) {
      return null;
    }

    if (this.catalogProvider() === type) {
      if (!this.catalogProviderReady()) {
        if (this.catalogProviderNeedsRepair()) {
          return `${this.labelFor(type)} stays locked as this instance's catalog provider even while unhealthy. Repair it here and Save & Test again. Reset catalog setup only if you need to switch providers.`;
        }

        return `${this.labelFor(type)} is already chosen and locked for this instance. Save & Test it here to finish catalog setup. Reset catalog setup only if you need to switch providers.`;
      }

      return `${this.labelFor(type)} is locked in as this instance's catalog provider. Repair it here if it later becomes unhealthy. Reset catalog setup only if you need to switch providers.`;
    }

    return `Choose ${this.labelFor(type)} for this Stasharr instance. Save & Test will lock it in. Changing provider type later requires resetting catalog setup and running setup again.`;
  }

  protected sectionLabel(type: IntegrationType): string {
    if (this.isCatalogProvider(type)) {
      return this.catalogProvider() === type
        ? 'Chosen catalog provider'
        : 'Catalog provider option';
    }

    return 'Required service';
  }

  protected readinessSummary(type: IntegrationType): string {
    const integration = this.integrations()[type];
    const label = this.labelFor(type);
    const state = this.readinessState(type);

    if (this.isCatalogProvider(type)) {
      switch (state) {
        case 'NOT_SAVED':
          return `Choose ${label} if you want this instance to use it as the catalog provider. Save & Test will lock that choice.`;
        case 'SAVED':
          return `${label} is chosen and locked for this instance, but it still needs a successful test before setup can continue.`;
        case 'TEST_FAILED':
          return `${label} is still the chosen catalog provider. Repair the connection details and Save & Test again, or reset catalog setup to switch providers.`;
        case 'READY':
          return `${label} is chosen, locked, and ready for this instance.`;
      }
    }

    switch (state) {
      case 'NOT_SAVED':
        return `Enter ${label} connection details, then Save & Test to continue setup.`;
      case 'SAVED':
        if (integration && !integration.enabled) {
          return `${label} is saved but disabled. Enable it, then Save & Test to continue setup.`;
        }

        return `${label} is saved but not ready yet. Save & Test to verify connectivity.`;
      case 'TEST_FAILED':
        return `Repair ${label} connection details if needed, then Save & Test again to continue setup.`;
      case 'READY':
        return `${label} is connected and ready. Use Save & Test after future changes to keep it healthy.`;
    }
  }

  protected actionHint(type: IntegrationType): string {
    switch (this.readinessState(type)) {
      case 'NOT_SAVED':
        return 'Default path: save these details and immediately run a connection test.';
      case 'SAVED':
        return 'Current settings are saved, but setup is still blocked until this service passes a test.';
      case 'TEST_FAILED':
        return 'Keep the error visible, repair the details if needed, and run Save & Test again.';
      case 'READY':
        return 'This service is ready right now. Use Save & Test after any changes.';
    }
  }

  protected lastHealthyAt(type: IntegrationType): string | null {
    return formatOptionalDateTime(this.integrations()[type]?.lastHealthyAt ?? null);
  }

  protected lastErrorAt(type: IntegrationType): string | null {
    return formatOptionalDateTime(this.integrations()[type]?.lastErrorAt ?? null);
  }

  protected hasStoredApiKey(type: IntegrationType): boolean {
    return this.integrations()[type]?.hasApiKey ?? false;
  }

  protected isSaving(type: IntegrationType): boolean {
    return this.saveState()[type].running;
  }

  protected isTesting(type: IntegrationType): boolean {
    return this.testState()[type].running;
  }

  protected isSaveAndTesting(type: IntegrationType): boolean {
    return this.saveAndTestState()[type].running;
  }

  protected isWorking(type: IntegrationType): boolean {
    return this.isSaving(type) || this.isTesting(type) || this.isSaveAndTesting(type);
  }

  protected messagesFor(type: IntegrationType): IntegrationRepairPanelMessage[] {
    const messages: IntegrationRepairPanelMessage[] = [];
    const saveAndTestState = this.saveAndTestState()[type];
    const saveState = this.saveState()[type];
    const testState = this.testState()[type];

    if (saveAndTestState.success) {
      messages.push({ severity: 'success', text: saveAndTestState.success });
    }
    if (saveAndTestState.error) {
      messages.push({ severity: 'error', text: saveAndTestState.error });
    }
    if (saveState.success) {
      messages.push({ severity: 'success', text: saveState.success });
    }
    if (saveState.error) {
      messages.push({ severity: 'error', text: saveState.error });
    }
    if (testState.success) {
      messages.push({ severity: 'success', text: testState.success });
    }
    if (testState.error) {
      messages.push({ severity: 'error', text: testState.error });
    }

    return messages;
  }

  protected saveIntegration(type: IntegrationType): void {
    const payload = buildIntegrationPayload(type, this.forms[type]);
    patchActionState(this.saveState, type, {
      running: true,
      success: null,
      error: null,
    });
    patchActionState(this.testState, type, { success: null, error: null });

    this.integrationsService
      .updateIntegration(type, payload)
      .pipe(
        switchMap((integration) =>
          this.refreshSetupState().pipe(map((snapshot) => ({ integration, ...snapshot }))),
        ),
        finalize(() => {
          patchActionState(this.saveState, type, { running: false });
        }),
      )
      .subscribe({
        next: ({ integration, status, integrations }) => {
          this.syncSetupState(status, integrations);
          const message = this.describeSaveSuccess(type, integration);
          this.notifications.success(message);
          patchActionState(this.saveState, type, {
            success: message,
            error: null,
          });
        },
        error: (error: unknown) => {
          const message = describeMutationError(error, `Failed to save ${this.labelFor(type)}.`);
          this.notifications.error(message);
          patchActionState(this.saveState, type, {
            success: null,
            error: message,
          });
        },
      });
  }

  protected saveAndTestIntegration(type: IntegrationType): void {
    const payload = buildIntegrationPayload(type, this.forms[type]);
    patchActionState(this.saveAndTestState, type, {
      running: true,
      success: null,
      error: null,
    });
    patchActionState(this.saveState, type, { success: null, error: null });
    patchActionState(this.testState, type, { success: null, error: null });

    this.integrationsService
      .updateIntegration(type, payload)
      .pipe(
        switchMap(() => this.integrationsService.testIntegration(type, payload)),
        switchMap((integration) =>
          this.refreshSetupState().pipe(map((snapshot) => ({ integration, ...snapshot }))),
        ),
        finalize(() => {
          patchActionState(this.saveAndTestState, type, { running: false });
        }),
      )
      .subscribe({
        next: ({ integration, status, integrations }) => {
          this.syncSetupState(status, integrations);

          if (integration.status === 'CONFIGURED') {
            const message = `${this.labelFor(type)} is ready.`;
            this.notifications.success(message);
            patchActionState(this.saveAndTestState, type, {
              success: message,
              error: null,
            });
            return;
          }

          const message = `${this.labelFor(type)} settings were saved, but the test failed.`;
          this.notifications.error(message);
          patchActionState(this.saveAndTestState, type, {
            success: null,
            error: message,
          });
        },
        error: (error: unknown) => {
          const message = describeMutationError(
            error,
            `Failed to save and test ${this.labelFor(type)}.`,
          );
          this.notifications.error(message);
          patchActionState(this.saveAndTestState, type, {
            success: null,
            error: message,
          });
        },
      });
  }

  protected testIntegration(type: IntegrationType): void {
    const payload = buildIntegrationPayload(type, this.forms[type]);
    patchActionState(this.testState, type, {
      running: true,
      success: null,
      error: null,
    });

    this.integrationsService
      .testIntegration(type, payload)
      .pipe(
        switchMap((integration) =>
          this.refreshSetupState().pipe(map((snapshot) => ({ integration, ...snapshot }))),
        ),
        finalize(() => {
          patchActionState(this.testState, type, { running: false });
        }),
      )
      .subscribe({
        next: ({ integration, status, integrations }) => {
          this.syncSetupState(status, integrations);

          if (integration.status === 'CONFIGURED') {
            const message = `${this.labelFor(type)} test passed.`;
            this.notifications.success(message);
            patchActionState(this.testState, type, {
              success: message,
              error: null,
            });
            return;
          }

          const message =
            integration.lastErrorMessage?.trim() || `${this.labelFor(type)} test failed.`;
          this.notifications.error(message);
          patchActionState(this.testState, type, {
            success: null,
            error: message,
          });
        },
        error: (error: unknown) => {
          const message = describeMutationError(error, `${this.labelFor(type)} test failed.`);
          this.notifications.error(message);
          patchActionState(this.testState, type, {
            success: null,
            error: message,
          });
        },
      });
  }

  protected resetCatalogProviderChoice(): void {
    const catalogProvider = this.catalogProvider();
    if (!catalogProvider || this.resettingCatalogProvider()) {
      return;
    }

    this.resettingCatalogProvider.set(true);
    this.integrationsService
      .resetIntegration(catalogProvider)
      .pipe(
        switchMap(() => this.refreshSetupState()),
        finalize(() => {
          this.resettingCatalogProvider.set(false);
        }),
      )
      .subscribe({
        next: ({ status, integrations }) => {
          this.syncSetupState(status, integrations);
          this.notifications.info('Catalog setup was reset');
        },
        error: (error: unknown) => {
          this.notifications.error(describeMutationError(error, 'Failed to reset catalog setup.'));
        },
      });
  }

  private loadSetupData(): void {
    this.loading.set(true);
    this.loadError.set(null);

    forkJoin({
      status: this.setupService.getStatus(),
      integrations: this.integrationsService.getIntegrations(),
    })
      .pipe(
        finalize(() => {
          this.loading.set(false);
        }),
      )
      .subscribe({
        next: (response) => {
          this.syncSetupState(response.status, response.integrations);
        },
        error: () => {
          this.loadError.set('Failed to load setup data from the API.');
        },
      });
  }

  private applyIntegrations(integrations: IntegrationResponse[]): void {
    const byType = mapIntegrationsByType(integrations);
    this.integrations.set(byType);

    for (const type of this.allIntegrationTypes) {
      const integration = byType[type];
      this.forms[type].setValue({
        name: integration?.name ?? '',
        baseUrl: integration?.baseUrl ?? '',
        apiKey: '',
        enabled: defaultEnabledValue(type, integration),
      });
    }
  }

  protected readinessState(type: IntegrationType): ReadinessState {
    return integrationReadinessState(this.integrations()[type]);
  }

  private catalogChecklistItem(): SetupChecklistItem {
    const catalogProvider = this.catalogProvider();
    if (!catalogProvider) {
      return {
        key: 'CATALOG',
        title: 'Catalog provider',
        state: 'NOT_SAVED',
        ready: false,
        summary: 'Choose StashDB or FansDB, then Save & Test the one you want to lock in.',
      };
    }

    const state = this.readinessState(catalogProvider);
    return {
      key: 'CATALOG',
      title: 'Catalog provider',
      state,
      ready: this.catalogProviderReady(),
      summary:
        state === 'READY'
          ? `${this.labelFor(catalogProvider)} chosen and ready.`
          : state === 'TEST_FAILED'
            ? `${this.labelFor(catalogProvider)} chosen, locked, and needs repair.`
            : `${this.labelFor(catalogProvider)} chosen and locked. Save & Test is still required.`,
    };
  }

  private requiredChecklistItem(
    type: Extract<IntegrationType, 'STASH' | 'WHISPARR'>,
  ): SetupChecklistItem {
    const state = this.readinessState(type);
    return {
      key: type,
      title: this.labelFor(type),
      state,
      ready: this.requiredServiceReady(type),
      summary: this.requiredChecklistSummary(type, state),
    };
  }

  private requiredChecklistSummary(
    type: Extract<IntegrationType, 'STASH' | 'WHISPARR'>,
    state: ReadinessState,
  ): string {
    const label = this.labelFor(type);
    const integration = this.integrations()[type];

    switch (state) {
      case 'NOT_SAVED':
        return `${label} still needs connection details.`;
      case 'SAVED':
        if (integration && !integration.enabled) {
          return `${label} is saved but disabled. Enable it, then Save & Test.`;
        }

        return `${label} is saved, but it still needs a passing test.`;
      case 'TEST_FAILED':
        return `${label} needs repair before setup can finish.`;
      case 'READY':
        return `${label} is ready.`;
    }
  }

  private requiredServiceReady(type: Extract<IntegrationType, 'STASH' | 'WHISPARR'>): boolean {
    const setupStatus = this.status();
    if (!setupStatus) {
      return false;
    }

    return type === 'STASH' ? setupStatus.required.stash : setupStatus.required.whisparr;
  }

  private nextStepSummary(): string {
    const catalogProvider = this.catalogProvider();
    if (!catalogProvider) {
      return 'Next step: choose a catalog provider and run Save & Test.';
    }

    if (!this.catalogProviderReady()) {
      if (this.catalogProviderNeedsRepair()) {
        return `Next step: repair ${this.labelFor(catalogProvider)} and run Save & Test again. Reset catalog setup only if you need a different provider.`;
      }

      return `Next step: finish ${this.labelFor(catalogProvider)} with Save & Test.`;
    }

    if (!this.requiredServiceReady('STASH')) {
      return `Next step: Save & Test Stash.`;
    }

    if (!this.requiredServiceReady('WHISPARR')) {
      return `Next step: Save & Test Whisparr.`;
    }

    return 'Every required service is ready.';
  }

  private refreshSetupState(): Observable<{
    status: SetupStatusResponse;
    integrations: IntegrationResponse[];
  }> {
    return forkJoin({
      status: this.setupService.getStatus(),
      integrations: this.integrationsService.getIntegrations(),
    });
  }

  private syncSetupState(status: SetupStatusResponse, integrations: IntegrationResponse[]): void {
    this.status.set(status);
    this.applyIntegrations(integrations);
  }

  private catalogProviderNeedsRepair(): boolean {
    const catalogProvider = this.catalogProvider();
    if (!catalogProvider) {
      return false;
    }

    return this.integrations()[catalogProvider]?.status === 'ERROR';
  }

  private describeSaveSuccess(type: IntegrationType, integration: IntegrationResponse): string {
    if (integration.status === 'ERROR') {
      return `${this.labelFor(type)} settings saved. Repair the connection details and run the test again.`;
    }

    if (isIntegrationReady(integration)) {
      return `${this.labelFor(type)} settings saved.`;
    }

    if (hasSavedIntegrationConfig(integration)) {
      return `${this.labelFor(type)} settings saved. Run a test to continue setup.`;
    }

    return `${this.labelFor(type)} settings saved.`;
  }
}

interface SetupChecklistItem {
  key: 'CATALOG' | 'STASH' | 'WHISPARR';
  title: string;
  state: ReadinessState;
  ready: boolean;
  summary: string;
}
