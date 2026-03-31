import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalize, forkJoin, switchMap } from 'rxjs';
import { ConfirmationService } from 'primeng/api';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Tab, TabList, TabPanel, TabPanels, Tabs } from 'primeng/tabs';
import { HealthService } from '../../core/api/health.service';
import { HealthStatusResponse } from '../../core/api/health.types';
import { IntegrationsService } from '../../core/api/integrations.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { IntegrationFormFieldsComponent } from '../../shared/integration-form-fields/integration-form-fields.component';
import {
  CatalogProviderType,
  IntegrationResponse,
  IntegrationType,
  UpdateIntegrationPayload,
  integrationLabel,
  isCatalogProviderType,
  resolveConfiguredCatalogProviderType,
} from '../../core/api/integrations.types';

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
    IntegrationFormFieldsComponent,
  ],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
})
export class SettingsPageComponent implements OnInit {
  private readonly integrationsService = inject(IntegrationsService);
  private readonly healthService = inject(HealthService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly health = signal<HealthStatusResponse | null>(null);
  protected readonly healthError = signal<string | null>(null);
  protected readonly refreshingHealth = signal(false);
  protected readonly activeTab = signal<SettingsTab>('STASH');
  protected readonly resettingAll = signal(false);

  private readonly allServiceTypes: IntegrationType[] = [
    'STASH',
    'WHISPARR',
    'STASHDB',
    'FANSDB',
  ];

  protected readonly serviceTabs = computed<ServiceTab[]>(() => {
    const catalogProvider = this.configuredCatalogProvider();
    return catalogProvider
      ? ['STASH', 'WHISPARR', catalogProvider]
      : ['STASH', 'WHISPARR'];
  });

  protected readonly forms: Record<IntegrationType, IntegrationForm> = {
    STASH: this.createIntegrationForm(),
    WHISPARR: this.createIntegrationForm(),
    STASHDB: this.createIntegrationForm(),
    FANSDB: this.createIntegrationForm(),
  };

  protected readonly integrations = signal<
    Record<IntegrationType, IntegrationResponse | null>
  >({
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

  protected readonly testState = signal<Record<IntegrationType, ActionState>>({
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

    if (
      nextValue === 'ABOUT' ||
      this.serviceTabs().includes(nextValue as IntegrationType)
    ) {
      this.activeTab.set(nextValue as SettingsTab);
    }
  }

  protected configured(type: IntegrationType): boolean {
    return this.integrations()[type]?.status === 'CONFIGURED';
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

  protected configuredCatalogProviderLabel(): string | null {
    const catalogProvider = this.configuredCatalogProvider();
    return catalogProvider ? this.labelFor(catalogProvider) : null;
  }

  protected catalogProviderSummary(): string {
    const label = this.configuredCatalogProviderLabel();
    if (label) {
      return `This Stasharr instance is configured for ${label}. To use a different catalog provider, reset catalog setup and re-run setup.`;
    }

    return 'No catalog provider is configured right now. Return to setup to choose StashDB or FansDB for this instance.';
  }

  protected catalogProviderHelp(type: IntegrationType): string | null {
    const configuredCatalogProvider = this.configuredCatalogProvider();
    if (!this.isCatalogProvider(type) || configuredCatalogProvider !== type) {
      return null;
    }

    return `${this.labelFor(type)} is the catalog provider configured for this Stasharr instance. Reset catalog setup before changing provider type.`;
  }

  protected formFor(type: IntegrationType): IntegrationForm {
    return this.forms[type];
  }

  protected statusText(type: IntegrationType): string {
    const integration = this.integrations()[type];
    if (!integration) {
      return 'NOT CONFIGURED';
    }

    return integration.status.replaceAll('_', ' ');
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

  protected isResetting(type: IntegrationType): boolean {
    return this.resetState()[type].running;
  }

  protected requestIntegrationReset(type: IntegrationType): void {
    if (this.isResetting(type) || this.resettingAll()) {
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
    if (this.resettingAll()) {
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
    const payload = this.payloadFromForm(type);
    this.patchActionState(this.saveState, type, {
      running: true,
      success: null,
      error: null,
    });
    this.patchActionState(this.testState, type, { success: null, error: null });

    this.integrationsService
      .updateIntegration(type, payload)
      .pipe(
        switchMap(() => this.integrationsService.getIntegrations()),
        finalize(() => {
          this.patchActionState(this.saveState, type, { running: false });
        }),
      )
      .subscribe({
        next: (integrations) => {
          this.applyIntegrations(integrations);
          this.notifications.success(`${this.labelFor(type)} settings saved`);
          this.patchActionState(this.saveState, type, {
            success: `${this.labelFor(type)} settings saved.`,
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

  protected testIntegration(type: IntegrationType): void {
    const payload = this.payloadFromForm(type);
    this.patchActionState(this.testState, type, {
      running: true,
      success: null,
      error: null,
    });

    this.integrationsService
      .testIntegration(type, payload)
      .pipe(
        finalize(() => {
          this.patchActionState(this.testState, type, { running: false });
        }),
      )
      .subscribe({
        next: (integration) => {
          this.updateIntegration(type, integration);
          this.notifications.success(`${this.labelFor(type)} test passed`);
          this.patchActionState(this.testState, type, {
            success: `${this.labelFor(type)} test passed.`,
            error: null,
          });
        },
        error: (error: unknown) => {
          const message = this.describeMutationError(
            error,
            `${this.labelFor(type)} test failed.`,
          );
          this.notifications.error(message);
          this.patchActionState(this.testState, type, {
            success: null,
            error: message,
          });
        },
      });
  }

  protected resetIntegration(type: IntegrationType): void {
    this.patchActionState(this.resetState, type, {
      running: true,
      success: null,
      error: null,
    });

    this.integrationsService
      .resetIntegration(type)
      .pipe(
        switchMap(() => this.integrationsService.getIntegrations()),
        finalize(() => {
          this.patchActionState(this.resetState, type, { running: false });
        }),
      )
      .subscribe({
        next: (integrations) => {
          this.applyIntegrations(integrations);
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
    this.resettingAll.set(true);

    this.integrationsService
      .resetAllIntegrations()
      .pipe(
        finalize(() => {
          this.resettingAll.set(false);
        }),
      )
      .subscribe({
        next: (integrations) => {
          this.applyIntegrations(integrations);
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
    })
      .pipe(
        finalize(() => {
          this.refreshingHealth.set(false);
        }),
      )
      .subscribe({
        next: ({ integrations, health }) => {
          this.applyIntegrations(integrations);
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
    })
      .pipe(
        finalize(() => {
          this.loading.set(false);
        }),
      )
      .subscribe({
        next: ({ integrations, health }) => {
          this.applyIntegrations(integrations);
          this.health.set(health);
        },
        error: () => {
          this.loadError.set('Failed to load settings data from the API.');
        },
      });
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
    if (
      activeTab !== 'ABOUT' &&
      !this.serviceTabs().includes(activeTab as IntegrationType)
    ) {
      this.activeTab.set('STASH');
    }
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

  private updateIntegration(type: IntegrationType, integration: IntegrationResponse): void {
    this.integrations.update((current) => ({
      ...current,
      [type]: integration,
    }));
  }

  private configuredCatalogProvider(): CatalogProviderType | null {
    return resolveConfiguredCatalogProviderType(
      Object.values(this.integrations()).filter(
        (integration): integration is IntegrationResponse => integration !== null,
      ),
    );
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

type IntegrationForm = FormGroup<{
  name: FormControl<string>;
  baseUrl: FormControl<string>;
  apiKey: FormControl<string>;
  enabled: FormControl<boolean>;
}>;
