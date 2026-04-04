import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable, finalize, forkJoin, map, switchMap } from 'rxjs';
import { ConfirmationService } from 'primeng/api';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Tab, TabList, TabPanel, TabPanels, Tabs } from 'primeng/tabs';
import { HealthService } from '../../core/api/health.service';
import { HealthStatusResponse } from '../../core/api/health.types';
import { IntegrationsService } from '../../core/api/integrations.service';
import {
  CatalogProviderType,
  IntegrationResponse,
  IntegrationType,
  ReadinessState,
  UpdateIntegrationPayload,
  hasSavedIntegrationConfig,
  integrationLabel,
  integrationReadinessLabel,
  integrationReadinessState,
  isCatalogProviderType,
} from '../../core/api/integrations.types';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { AccountSettingsSectionComponent } from '../../features/auth/account-settings-section.component';
import { IntegrationFormFieldsComponent } from '../../shared/integration-form-fields/integration-form-fields.component';

type ServiceTab = IntegrationType;
type SettingsTab = ServiceTab | 'ABOUT';

@Component({
  selector: 'app-settings-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    ButtonDirective,
    Message,
    ProgressSpinner,
    AccountSettingsSectionComponent,
    IntegrationFormFieldsComponent,
  ],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
})
export class SettingsPageComponent implements OnInit {
  private readonly integrationsService = inject(IntegrationsService);
  private readonly setupService = inject(SetupService);
  private readonly setupStatusStore = inject(SetupStatusStore);
  private readonly healthService = inject(HealthService);
  private readonly runtimeHealthService = inject(RuntimeHealthService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly health = signal<HealthStatusResponse | null>(null);
  protected readonly setupStatus = signal<SetupStatusResponse | null>(null);
  protected readonly healthError = signal<string | null>(null);
  protected readonly refreshingHealth = signal(false);
  protected readonly activeTab = signal<SettingsTab>('STASH');
  protected readonly resettingAll = signal(false);

  private readonly allServiceTypes: IntegrationType[] = ['STASH', 'WHISPARR', 'STASHDB', 'FANSDB'];

  protected readonly serviceTabs = computed<ServiceTab[]>(() => {
    const catalogProvider = this.catalogProvider();
    return catalogProvider ? ['STASH', 'WHISPARR', catalogProvider] : ['STASH', 'WHISPARR'];
  });

  protected readonly checklistItems = computed<SettingsChecklistItem[]>(() => [
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

  protected readonly allRequiredReady = computed(
    () => this.readyCount() === this.checklistItems().length,
  );

  protected readonly forms: Record<IntegrationType, IntegrationForm> = {
    STASH: this.createIntegrationForm(),
    WHISPARR: this.createIntegrationForm(),
    STASHDB: this.createIntegrationForm(),
    FANSDB: this.createIntegrationForm(),
  };

  protected readonly integrations = signal<Record<IntegrationType, IntegrationResponse | null>>({
    STASH: null,
    WHISPARR: null,
    STASHDB: null,
    FANSDB: null,
  });

  protected readonly saveState = signal<Record<IntegrationType, ActionState>>({
    STASH: this.defaultActionState(),
    WHISPARR: this.defaultActionState(),
    STASHDB: this.defaultActionState(),
    FANSDB: this.defaultActionState(),
  });

  protected readonly saveAndTestState = signal<Record<IntegrationType, ActionState>>({
    STASH: this.defaultActionState(),
    WHISPARR: this.defaultActionState(),
    STASHDB: this.defaultActionState(),
    FANSDB: this.defaultActionState(),
  });

  protected readonly resetState = signal<Record<IntegrationType, ActionState>>({
    STASH: this.defaultActionState(),
    WHISPARR: this.defaultActionState(),
    STASHDB: this.defaultActionState(),
    FANSDB: this.defaultActionState(),
  });

  ngOnInit(): void {
    this.loadSettingsData();
  }

  protected onTabsValueChange(nextValue: string | number | undefined): void {
    if (!nextValue) {
      return;
    }

    if (nextValue === 'ABOUT' || this.serviceTabs().includes(nextValue as IntegrationType)) {
      this.activeTab.set(nextValue as SettingsTab);
    }
  }

  protected configured(type: IntegrationType): boolean {
    return this.readinessState(type) === 'READY';
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

  protected sectionLabel(type: IntegrationType): string {
    if (this.isCatalogProvider(type)) {
      return this.catalogProvider() === type ? 'Chosen catalog provider' : 'Catalog provider';
    }

    return 'Required service';
  }

  protected integrationHealthLead(): string {
    return this.nextRepairSummary() ?? 'Every required service has passed readiness checks.';
  }

  protected integrationHealthSummary(): string {
    const catalogProvider = this.catalogProvider();
    if (!catalogProvider) {
      return 'Catalog provider: not chosen. Return to setup to lock StashDB or FansDB for this instance.';
    }

    const label = this.labelFor(catalogProvider);
    if (!this.catalogProviderReady()) {
      return `Catalog provider: ${label}. It stays locked to this instance even while unhealthy. Repair it here with Save & Test, or reset catalog setup only if you need to switch providers.`;
    }

    if (!this.allRequiredReady()) {
      return `Catalog provider: ${label}. Use Save & Test below to repair any required service that is no longer ready.`;
    }

    return `Catalog provider: ${label}. Use Save & Test after future changes to keep integrations healthy.`;
  }

  protected repairWarning(): string | null {
    if (this.allRequiredReady()) {
      return null;
    }

    const nextStep = this.nextRepairSummary();
    return nextStep
      ? `Repair needed: ${nextStep} Use Save & Test on the affected integration below.`
      : null;
  }

  protected configuredCatalogProviderLabel(): string | null {
    const catalogProvider = this.catalogProvider();
    return catalogProvider ? this.labelFor(catalogProvider) : null;
  }

  protected catalogProviderHelp(type: IntegrationType): string | null {
    const catalogProvider = this.catalogProvider();
    if (!this.isCatalogProvider(type) || catalogProvider !== type) {
      return null;
    }

    switch (this.readinessState(type)) {
      case 'NOT_SAVED':
      case 'SAVED':
        return `${this.labelFor(type)} remains this instance's catalog provider while it is not ready. Save & Test it here. Reset catalog setup only if you need to switch providers.`;
      case 'TEST_FAILED':
        return `${this.labelFor(type)} remains this instance's catalog provider even while unhealthy. Repair it here and Save & Test again. Reset catalog setup only if you need to switch providers.`;
      case 'READY':
        return `${this.labelFor(type)} is the catalog provider configured for this Stasharr instance. Reset catalog setup before changing provider type.`;
    }
  }

  protected formFor(type: IntegrationType): IntegrationForm {
    return this.forms[type];
  }

  protected readinessState(type: IntegrationType): ReadinessState {
    return integrationReadinessState(this.integrations()[type]);
  }

  protected readinessLabel(type: IntegrationType): string {
    return integrationReadinessLabel(this.readinessState(type));
  }

  protected readinessSummary(type: IntegrationType): string {
    const integration = this.integrations()[type];
    const label = this.labelFor(type);
    const state = this.readinessState(type);

    if (this.isCatalogProvider(type)) {
      switch (state) {
        case 'NOT_SAVED':
          return `${label} is still the chosen catalog provider for this instance, but its saved details are missing. Save & Test to repair it, or reset catalog setup to switch providers.`;
        case 'SAVED':
          return `${label} is still the chosen catalog provider, but it needs a successful test before this instance is ready again.`;
        case 'TEST_FAILED':
          return `${label} is still the chosen catalog provider. Repair the connection details and Save & Test again, or reset catalog setup to switch providers.`;
        case 'READY':
          return `${label} is chosen, locked, and ready for this instance.`;
      }
    }

    switch (state) {
      case 'NOT_SAVED':
        return `Enter ${label} connection details, then Save & Test to restore readiness.`;
      case 'SAVED':
        if (integration && !integration.enabled) {
          return `${label} is saved but disabled. Enable it, then Save & Test to restore readiness.`;
        }

        return `${label} is saved but not ready yet. Save & Test to verify connectivity.`;
      case 'TEST_FAILED':
        return `Repair ${label} connection details if needed, then Save & Test again to restore readiness.`;
      case 'READY':
        return `${label} is connected and ready. Use Save & Test after future changes to keep it healthy.`;
    }
  }

  protected actionHint(type: IntegrationType): string {
    switch (this.readinessState(type)) {
      case 'NOT_SAVED':
        return 'Default repair path: save these details and immediately run a connection test.';
      case 'SAVED':
        return 'Current settings are saved, but this service is not ready until it passes a test.';
      case 'TEST_FAILED':
        return 'Keep the error visible, repair the details if needed, and run Save & Test again.';
      case 'READY':
        return 'This service is ready right now. Use Save & Test after any changes.';
    }
  }

  protected hasStoredApiKey(type: IntegrationType): boolean {
    return this.integrations()[type]?.hasApiKey ?? false;
  }

  protected isSaving(type: IntegrationType): boolean {
    return this.saveState()[type].running;
  }

  protected isSaveAndTesting(type: IntegrationType): boolean {
    return this.saveAndTestState()[type].running;
  }

  protected isResetting(type: IntegrationType): boolean {
    return this.resetState()[type].running;
  }

  protected isBusy(type: IntegrationType): boolean {
    return this.isSaving(type) || this.isSaveAndTesting(type) || this.isResetting(type);
  }

  protected pageMutationRunning(): boolean {
    return this.resettingAll() || this.allServiceTypes.some((type) => this.isBusy(type));
  }

  protected requestIntegrationReset(type: IntegrationType): void {
    if (this.pageMutationRunning()) {
      return;
    }

    const isCatalogProvider = this.isCatalogProvider(type);
    this.confirmationService.confirm({
      key: 'app-destructive',
      header: isCatalogProvider
        ? 'Reset Catalog Setup?'
        : `Reset ${this.labelFor(type)} Integration?`,
      message: isCatalogProvider
        ? `Resetting ${this.labelFor(type)} clears this instance's catalog provider choice. Return to setup to choose StashDB or FansDB again.`
        : 'Reset this integration and clear saved configuration?',
      icon: 'pi pi-exclamation-triangle',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      acceptLabel: isCatalogProvider ? 'Reset catalog setup' : 'Confirm reset',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.resetIntegration(type);
      },
    });
  }

  protected requestResetAll(): void {
    if (this.pageMutationRunning()) {
      return;
    }

    this.confirmationService.confirm({
      key: 'app-destructive',
      header: 'Reset All Integrations?',
      message:
        'Resetting all integrations clears Stash, Whisparr, and the catalog provider choice for this instance.',
      icon: 'pi pi-exclamation-triangle',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      acceptLabel: 'Confirm reset all',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.resetAllIntegrations();
      },
    });
  }

  protected saveIntegration(type: IntegrationType): void {
    if (this.pageMutationRunning()) {
      return;
    }

    const payload = this.payloadFromForm(type);
    this.patchActionState(this.saveState, type, {
      running: true,
      success: null,
      error: null,
    });
    this.patchActionState(this.saveAndTestState, type, { success: null, error: null });

    this.integrationsService
      .updateIntegration(type, payload)
      .pipe(
        switchMap((integration) =>
          this.refreshSettingsState().pipe(map((snapshot) => ({ integration, ...snapshot }))),
        ),
        finalize(() => {
          this.patchActionState(this.saveState, type, { running: false });
        }),
      )
      .subscribe({
        next: ({ integration, setupStatus, integrations }) => {
          this.syncSettingsState(setupStatus, integrations);
          this.runtimeHealthService.requestRefresh();
          const message = this.describeSaveSuccess(type, integration);
          this.notifications.success(message);
          this.patchActionState(this.saveState, type, {
            success: message,
            error: null,
          });
        },
        error: (error: unknown) => {
          const message = this.describeMutationError(
            error,
            `Failed to save ${this.labelFor(type)} settings.`,
          );
          this.notifications.error(message);
          this.patchActionState(this.saveState, type, {
            success: null,
            error: message,
          });
        },
      });
  }

  protected saveAndTestIntegration(type: IntegrationType): void {
    if (this.pageMutationRunning()) {
      return;
    }

    const payload = this.payloadFromForm(type);
    this.patchActionState(this.saveAndTestState, type, {
      running: true,
      success: null,
      error: null,
    });
    this.patchActionState(this.saveState, type, { success: null, error: null });

    this.integrationsService
      .updateIntegration(type, payload)
      .pipe(
        switchMap(() => this.integrationsService.testIntegration(type, payload)),
        switchMap((integration) =>
          this.refreshSettingsState().pipe(map((snapshot) => ({ integration, ...snapshot }))),
        ),
        finalize(() => {
          this.patchActionState(this.saveAndTestState, type, { running: false });
        }),
      )
      .subscribe({
        next: ({ integration, setupStatus, integrations }) => {
          this.syncSettingsState(setupStatus, integrations);
          this.runtimeHealthService.requestRefresh();

          if (integration.status === 'CONFIGURED') {
            const message = `${this.labelFor(type)} is ready.`;
            this.notifications.success(message);
            this.patchActionState(this.saveAndTestState, type, {
              success: message,
              error: null,
            });
            return;
          }

          const message = `${this.labelFor(type)} settings were saved, but the test failed.`;
          this.notifications.error(message);
          this.patchActionState(this.saveAndTestState, type, {
            success: null,
            error: message,
          });
        },
        error: (error: unknown) => {
          const message = this.describeMutationError(
            error,
            `Failed to save and test ${this.labelFor(type)}.`,
          );
          this.notifications.error(message);
          this.patchActionState(this.saveAndTestState, type, {
            success: null,
            error: message,
          });
        },
      });
  }

  protected resetIntegration(type: IntegrationType): void {
    if (this.pageMutationRunning()) {
      return;
    }

    this.patchActionState(this.resetState, type, {
      running: true,
      success: null,
      error: null,
    });

    this.integrationsService
      .resetIntegration(type)
      .pipe(
        switchMap(() => this.refreshSettingsState()),
        finalize(() => {
          this.patchActionState(this.resetState, type, { running: false });
        }),
      )
      .subscribe({
        next: ({ setupStatus, integrations }) => {
          this.syncSettingsState(setupStatus, integrations);
          this.runtimeHealthService.requestRefresh();
          if (this.isCatalogProvider(type)) {
            this.notifications.info('Catalog setup was reset');
            this.activeTab.set('STASH');
            void this.router.navigateByUrl('/setup');
          } else {
            this.notifications.info(`${this.labelFor(type)} integration reset`);
          }
          this.patchActionState(this.resetState, type, {
            success: this.isCatalogProvider(type)
              ? 'Catalog setup has been reset.'
              : `${this.labelFor(type)} has been reset.`,
            error: null,
          });
        },
        error: (error: unknown) => {
          const message = this.describeMutationError(
            error,
            `Failed to reset ${this.labelFor(type)}.`,
          );
          this.notifications.error(message);
          this.patchActionState(this.resetState, type, {
            success: null,
            error: message,
          });
        },
      });
  }

  protected resetAllIntegrations(): void {
    if (this.pageMutationRunning()) {
      return;
    }

    this.resettingAll.set(true);

    this.integrationsService
      .resetAllIntegrations()
      .pipe(
        switchMap((integrations) =>
          this.setupService.getStatus().pipe(
            map((setupStatus) => ({
              setupStatus,
              integrations,
            })),
          ),
        ),
        finalize(() => {
          this.resettingAll.set(false);
        }),
      )
      .subscribe({
        next: ({ setupStatus, integrations }) => {
          this.syncSettingsState(setupStatus, integrations);
          this.runtimeHealthService.requestRefresh();
          this.notifications.info('All integrations were reset to not configured');
          this.activeTab.set('STASH');
          void this.router.navigateByUrl('/setup');
        },
        error: (error: unknown) => {
          this.notifications.error(
            this.describeMutationError(error, 'Failed to reset all integrations.'),
          );
        },
      });
  }

  protected refreshHealth(): void {
    this.refreshingHealth.set(true);
    this.healthError.set(null);

    forkJoin({
      integrations: this.integrationsService.getIntegrations(),
      health: this.healthService.getStatus(),
      setupStatus: this.setupService.getStatus(),
    })
      .pipe(
        finalize(() => {
          this.refreshingHealth.set(false);
        }),
      )
      .subscribe({
        next: ({ integrations, health, setupStatus }) => {
          this.syncSettingsState(setupStatus, integrations);
          this.health.set(health);
        },
        error: () => {
          this.healthError.set('Failed to refresh health data.');
        },
      });
  }

  protected lastHealthyAt(type: IntegrationType): string | null {
    const value = this.integrations()[type]?.lastHealthyAt;
    return value ? this.formatDateTime(value) : null;
  }

  protected lastErrorAt(type: IntegrationType): string | null {
    const value = this.integrations()[type]?.lastErrorAt;
    return value ? this.formatDateTime(value) : null;
  }

  private loadSettingsData(): void {
    this.loading.set(true);
    this.loadError.set(null);

    forkJoin({
      integrations: this.integrationsService.getIntegrations(),
      health: this.healthService.getStatus(),
      setupStatus: this.setupService.getStatus(),
    })
      .pipe(
        finalize(() => {
          this.loading.set(false);
        }),
      )
      .subscribe({
        next: ({ integrations, health, setupStatus }) => {
          this.syncSettingsState(setupStatus, integrations);
          this.health.set(health);
        },
        error: () => {
          this.loadError.set('Failed to load settings data from the API.');
        },
      });
  }

  private refreshSettingsState(): Observable<{
    setupStatus: SetupStatusResponse;
    integrations: IntegrationResponse[];
  }> {
    return forkJoin({
      setupStatus: this.setupService.getStatus(),
      integrations: this.integrationsService.getIntegrations(),
    });
  }

  private syncSettingsState(
    setupStatus: SetupStatusResponse,
    integrations: IntegrationResponse[],
  ): void {
    this.setupStatus.set(setupStatus);
    this.setupStatusStore.sync(setupStatus);
    this.applyIntegrations(integrations);
  }

  private applyIntegrations(integrations: IntegrationResponse[]): void {
    const byType: Record<IntegrationType, IntegrationResponse | null> = {
      STASH: null,
      WHISPARR: null,
      STASHDB: null,
      FANSDB: null,
    };

    for (const integration of integrations) {
      byType[integration.type] = integration;
    }

    this.integrations.set(byType);

    for (const type of this.allServiceTypes) {
      const integration = byType[type];
      this.forms[type].setValue({
        name: integration?.name ?? '',
        baseUrl: integration?.baseUrl ?? '',
        apiKey: '',
        enabled: this.defaultEnabledValue(type, integration),
      });
    }

    const activeTab = this.activeTab();
    if (activeTab !== 'ABOUT' && !this.serviceTabs().includes(activeTab as IntegrationType)) {
      this.activeTab.set('STASH');
    }
  }

  private payloadFromForm(type: IntegrationType): UpdateIntegrationPayload {
    const formValue = this.forms[type].getRawValue();
    const payload: UpdateIntegrationPayload = {
      enabled: this.isCatalogProvider(type) ? true : formValue.enabled,
      name: this.normalizeInput(formValue.name),
      baseUrl: this.normalizeInput(formValue.baseUrl),
    };

    const apiKey = this.normalizeInput(formValue.apiKey);
    if (apiKey) {
      payload.apiKey = apiKey;
    }

    return payload;
  }

  private defaultEnabledValue(
    type: IntegrationType,
    integration: IntegrationResponse | null,
  ): boolean {
    if (integration) {
      return integration.enabled;
    }

    return this.isCatalogProvider(type) ? false : true;
  }

  private catalogProvider(): CatalogProviderType | null {
    return this.setupStatus()?.catalogProvider ?? null;
  }

  private catalogProviderReady(): boolean {
    return this.setupStatus()?.required.catalog ?? false;
  }

  private requiredServiceReady(type: Extract<IntegrationType, 'STASH' | 'WHISPARR'>): boolean {
    const setupStatus = this.setupStatus();
    if (!setupStatus) {
      return false;
    }

    return type === 'STASH' ? setupStatus.required.stash : setupStatus.required.whisparr;
  }

  private nextRepairSummary(): string | null {
    const catalogProvider = this.catalogProvider();
    if (!catalogProvider) {
      return 'Catalog provider still needs setup.';
    }

    if (!this.catalogProviderReady()) {
      return this.blockingSummary(catalogProvider, true);
    }

    if (!this.requiredServiceReady('STASH')) {
      return this.blockingSummary('STASH', false);
    }

    if (!this.requiredServiceReady('WHISPARR')) {
      return this.blockingSummary('WHISPARR', false);
    }

    return null;
  }

  private blockingSummary(type: IntegrationType, isCatalogProvider: boolean): string {
    const label = this.labelFor(type);
    switch (this.readinessState(type)) {
      case 'NOT_SAVED':
        return isCatalogProvider
          ? `${label} still needs saved connection details.`
          : `${label} still needs connection details.`;
      case 'SAVED':
        return `${label} still needs Save & Test.`;
      case 'TEST_FAILED':
        return `${label} needs repair.`;
      case 'READY':
        return `${label} is ready.`;
    }
  }

  private catalogChecklistItem(): SettingsChecklistItem {
    const catalogProvider = this.catalogProvider();
    if (!catalogProvider) {
      return {
        key: 'CATALOG',
        title: 'Catalog provider',
        state: 'NOT_SAVED',
        ready: false,
        summary:
          'No catalog provider is locked right now. Return to setup to choose StashDB or FansDB.',
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
            : state === 'NOT_SAVED'
              ? `${this.labelFor(catalogProvider)} stays locked, but its details need to be saved again.`
              : `${this.labelFor(catalogProvider)} chosen and locked. Save & Test is still required.`,
    };
  }

  private requiredChecklistItem(
    type: Extract<IntegrationType, 'STASH' | 'WHISPARR'>,
  ): SettingsChecklistItem {
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
        return `${label} needs repair.`;
      case 'READY':
        return `${label} is ready.`;
    }
  }

  private createIntegrationForm(): IntegrationForm {
    return new FormGroup({
      name: new FormControl('', { nonNullable: true }),
      baseUrl: new FormControl('', { nonNullable: true }),
      apiKey: new FormControl('', { nonNullable: true }),
      enabled: new FormControl(true, { nonNullable: true }),
    });
  }

  private normalizeInput(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  }

  private describeMutationError(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const message = error.error?.message;
      if (typeof message === 'string' && message.trim().length > 0) {
        return message;
      }

      if (Array.isArray(message) && message.length > 0) {
        return message.join(' ');
      }
    }

    return fallback;
  }

  private describeSaveSuccess(type: IntegrationType, integration: IntegrationResponse): string {
    if (integration.status === 'ERROR') {
      return `${this.labelFor(type)} settings saved. Repair the connection details and run Save & Test again.`;
    }

    if (integrationReadinessState(integration) === 'READY') {
      return `${this.labelFor(type)} settings saved.`;
    }

    if (hasSavedIntegrationConfig(integration)) {
      return `${this.labelFor(type)} settings saved. Run Save & Test to verify readiness.`;
    }

    return `${this.labelFor(type)} settings saved.`;
  }

  private defaultActionState(): ActionState {
    return {
      running: false,
      success: null,
      error: null,
    };
  }

  private patchActionState(
    store: {
      update: (
        updater: (
          state: Record<IntegrationType, ActionState>,
        ) => Record<IntegrationType, ActionState>,
      ) => void;
    },
    type: IntegrationType,
    patch: Partial<ActionState>,
  ): void {
    store.update((current) => ({
      ...current,
      [type]: {
        ...current[type],
        ...patch,
      },
    }));
  }
}

interface ActionState {
  running: boolean;
  success: string | null;
  error: string | null;
}

interface SettingsChecklistItem {
  key: 'CATALOG' | 'STASH' | 'WHISPARR';
  title: string;
  state: ReadinessState;
  ready: boolean;
  summary: string;
}

type IntegrationForm = FormGroup<{
  name: FormControl<string>;
  baseUrl: FormControl<string>;
  apiKey: FormControl<string>;
  enabled: FormControl<boolean>;
}>;
