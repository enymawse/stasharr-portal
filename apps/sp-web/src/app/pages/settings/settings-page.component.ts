import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { HealthService } from '../../core/api/health.service';
import { HealthStatusResponse } from '../../core/api/health.types';
import { IntegrationsService } from '../../core/api/integrations.service';
import {
  IntegrationResponse,
  IntegrationType,
  UpdateIntegrationPayload,
} from '../../core/api/integrations.types';

@Component({
  selector: 'app-settings-page',
  imports: [ReactiveFormsModule],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
})
export class SettingsPageComponent implements OnInit {
  private readonly integrationsService = inject(IntegrationsService);
  private readonly healthService = inject(HealthService);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly health = signal<HealthStatusResponse | null>(null);
  protected readonly refreshingHealth = signal(false);
  protected readonly healthError = signal<string | null>(null);
  protected readonly feedback = signal<string | null>(null);
  protected readonly confirmResetType = signal<IntegrationType | null>(null);
  protected readonly confirmResetAll = signal(false);
  protected readonly resettingAll = signal(false);

  protected readonly integrationTypes: IntegrationType[] = [
    'STASH',
    'WHISPARR',
    'STASHDB',
  ];

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

  protected readonly saveState = signal<Record<IntegrationType, SaveState>>({
    STASH: this.defaultSaveState(),
    WHISPARR: this.defaultSaveState(),
    STASHDB: this.defaultSaveState(),
  });

  protected readonly resetState = signal<Record<IntegrationType, ResetState>>({
    STASH: this.defaultResetState(),
    WHISPARR: this.defaultResetState(),
    STASHDB: this.defaultResetState(),
  });

  ngOnInit(): void {
    this.loadSettingsData();
  }

  protected formFor(type: IntegrationType): IntegrationForm {
    return this.forms[type];
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

  protected statusText(type: IntegrationType): string {
    const integration = this.integrations()[type];
    if (!integration) {
      return 'Not configured';
    }

    return integration.status.replaceAll('_', ' ');
  }

  protected hasStoredApiKey(type: IntegrationType): boolean {
    return this.integrations()[type]?.hasApiKey ?? false;
  }

  protected isSaving(type: IntegrationType): boolean {
    return this.saveState()[type].saving;
  }

  protected saveSuccess(type: IntegrationType): string | null {
    return this.saveState()[type].success;
  }

  protected saveError(type: IntegrationType): string | null {
    return this.saveState()[type].error;
  }

  protected isResetting(type: IntegrationType): boolean {
    return this.resetState()[type].resetting;
  }

  protected resetSuccess(type: IntegrationType): string | null {
    return this.resetState()[type].success;
  }

  protected resetError(type: IntegrationType): string | null {
    return this.resetState()[type].error;
  }

  protected lastHealthyAt(type: IntegrationType): string | null {
    const value = this.integrations()[type]?.lastHealthyAt;
    return value ? this.formatDateTime(value) : null;
  }

  protected lastErrorAt(type: IntegrationType): string | null {
    const value = this.integrations()[type]?.lastErrorAt;
    return value ? this.formatDateTime(value) : null;
  }

  protected saveIntegration(type: IntegrationType): void {
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

    this.patchSaveState(type, { saving: true, success: null, error: null });
    this.feedback.set(null);

    this.integrationsService
      .updateIntegration(type, payload)
      .pipe(
        finalize(() => {
          this.patchSaveState(type, { saving: false });
        }),
      )
      .subscribe({
        next: (integration) => {
          this.integrations.update((current) => ({
            ...current,
            [type]: integration,
          }));
          this.forms[type].patchValue({ apiKey: '' });
          this.patchSaveState(type, {
            success: `${this.labelFor(type)} settings saved.`,
            error: null,
          });
        },
        error: () => {
          this.patchSaveState(type, {
            success: null,
            error: `Failed to save ${this.labelFor(type)} settings.`,
          });
        },
      });
  }

  protected requestIntegrationReset(type: IntegrationType): void {
    this.feedback.set(null);
    this.confirmResetType.set(type);
  }

  protected cancelIntegrationReset(type: IntegrationType): void {
    if (this.confirmResetType() === type) {
      this.confirmResetType.set(null);
    }
  }

  protected shouldConfirmReset(type: IntegrationType): boolean {
    return this.confirmResetType() === type;
  }

  protected resetIntegration(type: IntegrationType): void {
    this.patchResetState(type, { resetting: true, success: null, error: null });
    this.feedback.set(null);

    this.integrationsService
      .resetIntegration(type)
      .pipe(
        finalize(() => {
          this.patchResetState(type, { resetting: false });
        }),
      )
      .subscribe({
        next: (integration) => {
          this.integrations.update((current) => ({
            ...current,
            [type]: integration,
          }));
          this.forms[type].setValue({
            name: '',
            baseUrl: '',
            apiKey: '',
            enabled: integration.enabled,
          });
          this.confirmResetType.set(null);
          this.patchResetState(type, {
            success: `${this.labelFor(type)} has been reset.`,
            error: null,
          });
        },
        error: () => {
          this.patchResetState(type, {
            success: null,
            error: `Failed to reset ${this.labelFor(type)}.`,
          });
        },
      });
  }

  protected requestResetAll(): void {
    this.confirmResetAll.set(true);
    this.feedback.set(null);
  }

  protected cancelResetAll(): void {
    this.confirmResetAll.set(false);
  }

  protected resetAllIntegrations(): void {
    this.resettingAll.set(true);
    this.feedback.set(null);
    this.healthError.set(null);

    this.integrationsService
      .resetAllIntegrations()
      .pipe(
        finalize(() => {
          this.resettingAll.set(false);
        }),
      )
      .subscribe({
        next: (integrations) => {
          this.confirmResetAll.set(false);
          this.applyIntegrations(integrations);
          this.feedback.set('All integrations were reset to not configured.');
        },
        error: () => {
          this.feedback.set('Failed to reset all integrations.');
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
          this.healthError.set('Failed to refresh service health.');
        },
      });
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

    for (const type of this.integrationTypes) {
      const integration = byType[type];
      this.forms[type].setValue({
        name: integration?.name ?? '',
        baseUrl: integration?.baseUrl ?? '',
        apiKey: '',
        enabled: integration?.enabled ?? true,
      });
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
    return trimmed.length === 0 ? undefined : trimmed;
  }

  private formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString();
  }

  private defaultSaveState(): SaveState {
    return {
      saving: false,
      success: null,
      error: null,
    };
  }

  private defaultResetState(): ResetState {
    return {
      resetting: false,
      success: null,
      error: null,
    };
  }

  private patchSaveState(type: IntegrationType, patch: Partial<SaveState>): void {
    this.saveState.update((current) => ({
      ...current,
      [type]: {
        ...current[type],
        ...patch,
      },
    }));
  }

  private patchResetState(type: IntegrationType, patch: Partial<ResetState>): void {
    this.resetState.update((current) => ({
      ...current,
      [type]: {
        ...current[type],
        ...patch,
      },
    }));
  }
}

interface SaveState {
  saving: boolean;
  success: string | null;
  error: string | null;
}

interface ResetState {
  resetting: boolean;
  success: string | null;
  error: string | null;
}

type IntegrationForm = FormGroup<{
  name: FormControl<string>;
  baseUrl: FormControl<string>;
  apiKey: FormControl<string>;
  enabled: FormControl<boolean>;
}>;
