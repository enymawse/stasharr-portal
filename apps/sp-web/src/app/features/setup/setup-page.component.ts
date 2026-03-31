import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { finalize, forkJoin, switchMap } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
  IntegrationResponse,
  IntegrationType,
  UpdateIntegrationPayload,
  integrationLabel,
  isCatalogProviderType,
} from '../../core/api/integrations.types';
import { IntegrationsService } from '../../core/api/integrations.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusResponse } from '../../core/api/setup.types';
import { IntegrationFormFieldsComponent } from '../../shared/integration-form-fields/integration-form-fields.component';

@Component({
  selector: 'app-setup-page',
  imports: [
    ReactiveFormsModule,
    Message,
    ProgressSpinner,
    ButtonDirective,
    IntegrationFormFieldsComponent,
  ],
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
    'FANSDB',
  ];

  protected readonly forms: Record<IntegrationType, IntegrationForm> = {
    STASH: this.createIntegrationForm(),
    WHISPARR: this.createIntegrationForm(),
    STASHDB: this.createIntegrationForm(),
    FANSDB: this.createIntegrationForm(),
  };

  private readonly integrations = signal<
    Record<IntegrationType, IntegrationResponse | null>
  >({
    STASH: null,
    WHISPARR: null,
    STASHDB: null,
    FANSDB: null,
  });

  private readonly saveState = signal<Record<IntegrationType, SaveState>>({
    STASH: this.defaultSaveState(),
    WHISPARR: this.defaultSaveState(),
    STASHDB: this.defaultSaveState(),
    FANSDB: this.defaultSaveState(),
  });

  protected readonly isSetupComplete = computed(
    () => this.status()?.setupComplete ?? false,
  );

  ngOnInit(): void {
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

  protected isActiveCatalogProvider(type: IntegrationType): boolean {
    return this.status()?.activeCatalogProvider === type;
  }

  protected integrationMeta(type: IntegrationType): string {
    if (this.isCatalogProvider(type)) {
      return `${this.isActiveCatalogProvider(type) ? 'Active Catalog Provider' : 'Catalog Provider'} | Status: ${this.statusText(type)}`;
    }

    return `Required Service | Status: ${this.statusText(type)}`;
  }

  protected setupSummary(): string {
    const activeCatalogProvider = this.status()?.activeCatalogProvider;
    if (this.isSetupComplete()) {
      return `Setup complete: Stash, Whisparr, and ${activeCatalogProvider ? this.labelFor(activeCatalogProvider) : 'your active catalog provider'} are configured.`;
    }

    if (activeCatalogProvider) {
      return `Setup incomplete: finish configuring Stash, Whisparr, and the active catalog provider ${this.labelFor(activeCatalogProvider)}.`;
    }

    return 'Setup incomplete: configure Stash, Whisparr, and enable one catalog provider to continue.';
  }

  protected catalogProviderHelp(type: IntegrationType): string | null {
    if (!this.isCatalogProvider(type)) {
      return null;
    }

    return this.isActiveCatalogProvider(type)
      ? `${this.labelFor(type)} currently drives /scenes, scene detail, performers, studios, and request metadata.`
      : `Enable and save ${this.labelFor(type)} to make it the active discovery source.`;
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
        switchMap(() =>
          forkJoin({
            setupStatus: this.setupService.getStatus(),
            integrations: this.integrationsService.getIntegrations(),
          }),
        ),
        finalize(() => {
          this.patchSaveState(type, { saving: false });
        }),
      )
      .subscribe({
        next: ({ setupStatus, integrations }) => {
          this.status.set(setupStatus);
          this.applyIntegrations(integrations);
          this.notifications.success(`${this.labelFor(type)} saved successfully`);
          this.patchSaveState(type, {
            success: `${this.labelFor(type)} saved successfully.`,
            error: null,
          });

          if (setupStatus.setupComplete) {
            void this.router.navigateByUrl('/scenes');
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
            void this.router.navigateByUrl('/scenes');
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
      FANSDB: null,
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
        enabled: this.defaultEnabledValue(type, integration),
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

  private defaultEnabledValue(
    type: IntegrationType,
    integration: IntegrationResponse | null,
  ): boolean {
    if (integration) {
      return integration.enabled;
    }

    return this.isCatalogProvider(type) ? false : true;
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
