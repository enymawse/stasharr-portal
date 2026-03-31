import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { finalize, forkJoin, switchMap } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
  CatalogProviderType,
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
  protected readonly resettingCatalogProvider = signal(false);

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

  protected showEnabledToggle(type: IntegrationType): boolean {
    return !this.isCatalogProvider(type);
  }

  protected catalogProvider(): CatalogProviderType | null {
    return this.status()?.catalogProvider ?? null;
  }

  protected integrationMeta(type: IntegrationType): string {
    if (this.isCatalogProvider(type)) {
      return `${this.catalogProvider() === type ? 'Instance Catalog Provider' : 'Catalog Provider Option'} | Status: ${this.statusText(type)}`;
    }

    return `Required Service | Status: ${this.statusText(type)}`;
  }

  protected setupSummary(): string {
    const catalogProvider = this.catalogProvider();
    if (this.isSetupComplete()) {
      return `Setup complete: this Stasharr instance uses ${catalogProvider ? this.labelFor(catalogProvider) : 'its catalog provider'} with Stash and Whisparr configured.`;
    }

    if (catalogProvider) {
      return `Setup in progress: this Stasharr instance is configured for ${this.labelFor(catalogProvider)}. Finish Stash and Whisparr, or reset catalog setup to choose a different provider.`;
    }

    return 'Setup in progress: choose the catalog provider for this Stasharr instance, then configure Stash and Whisparr.';
  }

  protected catalogProviderHelp(type: IntegrationType): string | null {
    if (!this.isCatalogProvider(type)) {
      return null;
    }

    if (this.catalogProvider() === type) {
      return `${this.labelFor(type)} is locked in as this instance's catalog provider. /scenes, performers, studios, requests, and indexing will use it.`;
    }

    return `Choose ${this.labelFor(type)} for this Stasharr instance. Changing provider type later requires resetting catalog setup and running setup again.`;
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
      enabled: this.isCatalogProvider(type) ? true : formValue.enabled,
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
        error: (error: unknown) => {
          const message = this.describeMutationError(
            error,
            `Failed to save ${this.labelFor(type)}.`,
          );
          this.notifications.error(message);
          this.patchSaveState(type, {
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
        switchMap(() =>
          forkJoin({
            status: this.setupService.getStatus(),
            integrations: this.integrationsService.getIntegrations(),
          }),
        ),
        finalize(() => {
          this.resettingCatalogProvider.set(false);
        }),
      )
      .subscribe({
        next: ({ status, integrations }) => {
          this.status.set(status);
          this.applyIntegrations(integrations);
          this.notifications.info('Catalog setup was reset');
        },
        error: (error: unknown) => {
          this.notifications.error(
            this.describeMutationError(error, 'Failed to reset catalog setup.'),
          );
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

    for (const type of this.allIntegrationTypes) {
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
