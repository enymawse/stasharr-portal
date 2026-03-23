import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
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
  IntegrationResponse,
  IntegrationType,
  UpdateIntegrationPayload,
} from '../../core/api/integrations.types';

type ServiceTab = IntegrationType;
type SettingsTab = ServiceTab | 'ABOUT';

@Component({
  selector: 'app-settings-page',
  imports: [
    ReactiveFormsModule,
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

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly health = signal<HealthStatusResponse | null>(null);
  protected readonly healthError = signal<string | null>(null);
  protected readonly refreshingHealth = signal(false);
  protected readonly activeTab = signal<SettingsTab>('STASH');
  protected readonly resettingAll = signal(false);

  protected readonly serviceTabs: ServiceTab[] = ['STASH', 'WHISPARR', 'STASHDB'];

  protected readonly forms: Record<IntegrationType, IntegrationForm> = {
    STASH: this.createIntegrationForm(),
    WHISPARR: this.createIntegrationForm(),
    STASHDB: this.createIntegrationForm(),
  };

  protected readonly integrations = signal<
    Record<IntegrationType, IntegrationResponse | null>
  >({
    STASH: null,
    WHISPARR: null,
    STASHDB: null,
  });

  protected readonly saveState = signal<Record<IntegrationType, ActionState>>({
    STASH: this.defaultActionState(),
    WHISPARR: this.defaultActionState(),
    STASHDB: this.defaultActionState(),
  });

  protected readonly testState = signal<Record<IntegrationType, ActionState>>({
    STASH: this.defaultActionState(),
    WHISPARR: this.defaultActionState(),
    STASHDB: this.defaultActionState(),
  });

  protected readonly resetState = signal<Record<IntegrationType, ActionState>>({
    STASH: this.defaultActionState(),
    WHISPARR: this.defaultActionState(),
    STASHDB: this.defaultActionState(),
  });

  ngOnInit(): void {
    this.loadSettingsData();
  }

  protected setActiveTab(tab: SettingsTab): void {
    this.activeTab.set(tab);
  }

  protected onTabsValueChange(nextValue: string | number | undefined): void {
    if (!nextValue) {
      return;
    }

    if (nextValue === 'ABOUT' || this.serviceTabs.includes(nextValue as IntegrationType)) {
      this.activeTab.set(nextValue as SettingsTab);
    }
  }

  protected isActiveTab(tab: SettingsTab): boolean {
    return this.activeTab() === tab;
  }

  protected isServiceTabActive(type: IntegrationType): boolean {
    return this.activeTab() === type;
  }

  protected configured(type: IntegrationType): boolean {
    return this.integrations()[type]?.status === 'CONFIGURED';
  }

  protected labelFor(type: IntegrationType): string {
    switch (type) {
      case 'STASH':
        return 'Stash';
      case 'WHISPARR':
        return 'Whisparr';
      case 'STASHDB':
        return 'StashDB';
    }
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

    this.confirmationService.confirm({
      key: 'app-destructive',
      header: `Reset ${this.labelFor(type)} Integration?`,
      message: 'Reset this integration and clear saved configuration?',
      icon: 'pi pi-exclamation-triangle',
      rejectLabel: 'Cancel',
      rejectButtonStyleClass: 'p-button-text',
      acceptLabel: 'Confirm reset',
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
      message: 'Resetting all integrations clears configuration for Stash, Whisparr, and StashDB.',
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
        finalize(() => {
          this.patchActionState(this.saveState, type, { running: false });
        }),
      )
      .subscribe({
        next: (integration) => {
          this.updateIntegration(type, integration);
          this.forms[type].patchValue({ apiKey: '' });
          this.notifications.success(`${this.labelFor(type)} settings saved`);
          this.patchActionState(this.saveState, type, {
            success: `${this.labelFor(type)} settings saved.`,
            error: null,
          });
        },
        error: () => {
          this.notifications.error(`Failed to save ${this.labelFor(type)} settings`);
          this.patchActionState(this.saveState, type, {
            success: null,
            error: `Failed to save ${this.labelFor(type)} settings.`,
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
        error: () => {
          this.notifications.error(`${this.labelFor(type)} test failed`);
          this.patchActionState(this.testState, type, {
            success: null,
            error: `${this.labelFor(type)} test failed.`,
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
        finalize(() => {
          this.patchActionState(this.resetState, type, { running: false });
        }),
      )
      .subscribe({
        next: (integration) => {
          this.updateIntegration(type, integration);
          this.forms[type].setValue({
            name: '',
            baseUrl: '',
            apiKey: '',
            enabled: integration.enabled,
          });
          this.notifications.info(`${this.labelFor(type)} integration reset`);
          this.patchActionState(this.resetState, type, {
            success: `${this.labelFor(type)} has been reset.`,
            error: null,
          });
        },
        error: () => {
          this.notifications.error(`Failed to reset ${this.labelFor(type)}`);
          this.patchActionState(this.resetState, type, {
            success: null,
            error: `Failed to reset ${this.labelFor(type)}.`,
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
        },
        error: () => {
          this.notifications.error('Failed to reset all integrations');
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
      enabled: formValue.enabled,
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
    };

    for (const integration of integrations) {
      byType[integration.type] = integration;
    }

    this.integrations.set(byType);

    for (const type of this.serviceTabs) {
      const integration = byType[type];
      this.forms[type].setValue({
        name: integration?.name ?? '',
        baseUrl: integration?.baseUrl ?? '',
        apiKey: '',
        enabled: integration?.enabled ?? true,
      });
    }
  }

  private updateIntegration(type: IntegrationType, integration: IntegrationResponse): void {
    this.integrations.update((current) => ({
      ...current,
      [type]: integration,
    }));
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
