import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { finalize, forkJoin, map, switchMap } from 'rxjs';
import { Message } from 'primeng/message';
import {
  IntegrationResponse,
  IntegrationType,
  UpdateIntegrationPayload,
} from '../../core/api/integrations.types';
import { IntegrationsService } from '../../core/api/integrations.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusResponse } from '../../core/api/setup.types';

@Component({
  selector: 'app-setup-page',
  imports: [ReactiveFormsModule, Message],
  templateUrl: './setup-page.component.html',
  styleUrl: './setup-page.component.scss',
})
export class SetupPageComponent implements OnInit {
  private readonly setupService = inject(SetupService);
  private readonly integrationsService = inject(IntegrationsService);
  private readonly notifications = inject(AppNotificationsService);
  private readonly router = inject(Router);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly status = signal<SetupStatusResponse | null>(null);

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

  private readonly integrations = signal<
    Record<IntegrationType, IntegrationResponse | null>
  >({
    STASH: null,
    WHISPARR: null,
    STASHDB: null,
  });

  private readonly saveState = signal<Record<IntegrationType, SaveState>>({
    STASH: this.defaultSaveState(),
    WHISPARR: this.defaultSaveState(),
    STASHDB: this.defaultSaveState(),
  });

  protected readonly isSetupComplete = computed(() => {
    const setupStatus = this.status();
    if (!setupStatus) {
      return false;
    }

    return (
      setupStatus.required.stash &&
      setupStatus.required.whisparr &&
      setupStatus.required.stashdb
    );
  });

  ngOnInit(): void {
    this.loadSetupData();
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

  protected isRequired(type: IntegrationType): boolean {
    return type === 'STASH' || type === 'WHISPARR' || type === 'STASHDB';
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

    this.patchSaveState(type, {
      saving: true,
      success: null,
      error: null,
    });

    this.integrationsService
      .updateIntegration(type, payload)
      .pipe(
        switchMap((integration) =>
          this.setupService
            .getStatus()
            .pipe(map((setupStatus) => ({ integration, setupStatus }))),
        ),
        finalize(() => {
          this.patchSaveState(type, { saving: false });
        }),
      )
      .subscribe({
        next: ({ integration, setupStatus }) => {
          this.status.set(setupStatus);
          this.integrations.update((current) => ({
            ...current,
            [type]: integration,
          }));
          this.forms[type].patchValue({
            apiKey: '',
          });
          this.notifications.success(`${this.labelFor(type)} saved successfully`);
          this.patchSaveState(type, {
            success: `${this.labelFor(type)} saved successfully.`,
            error: null,
          });

          if (setupStatus.setupComplete) {
            void this.router.navigateByUrl('/discover');
          }
        },
        error: () => {
          this.notifications.error(`Failed to save ${this.labelFor(type)}`);
          this.patchSaveState(type, {
            success: null,
            error: `Failed to save ${this.labelFor(type)}.`,
          });
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
          this.status.set(response.status);
          this.applyIntegrations(response.integrations);

          if (response.status.setupComplete) {
            void this.router.navigateByUrl('/discover');
          }
        },
        error: () => {
          this.loadError.set('Failed to load setup data from the API.');
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
    return trimmed === '' ? undefined : trimmed;
  }

  private defaultSaveState(): SaveState {
    return {
      saving: false,
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
}

interface SaveState {
  saving: boolean;
  success: string | null;
  error: string | null;
}

type IntegrationForm = FormGroup<{
  name: FormControl<string>;
  baseUrl: FormControl<string>;
  apiKey: FormControl<string>;
  enabled: FormControl<boolean>;
}>;
