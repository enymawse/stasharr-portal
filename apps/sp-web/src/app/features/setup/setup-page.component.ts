import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { finalize, forkJoin, map, switchMap } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import {
  CatalogProviderType,
  IntegrationResponse,
  IntegrationType,
  UpdateIntegrationPayload,
  hasSavedIntegrationConfig,
  integrationLabel,
  isIntegrationReady,
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

  private readonly integrations = signal<Record<IntegrationType, IntegrationResponse | null>>({
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

  protected readonly isSetupComplete = computed(() => this.status()?.setupComplete ?? false);

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

  protected catalogProviderReady(): boolean {
    return this.status()?.required.catalog ?? false;
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
      if (!this.catalogProviderReady()) {
        if (this.catalogProviderNeedsRepair()) {
          return `Setup in progress: this Stasharr instance is locked to ${this.labelFor(catalogProvider)}, but that catalog integration needs repair before setup can finish. Repair it below or reset catalog setup to choose a different provider.`;
        }

        return `Setup in progress: this Stasharr instance is locked to ${this.labelFor(catalogProvider)}, but that catalog integration still needs a successful test before setup can finish. Test or repair it below, or reset catalog setup to choose a different provider.`;
      }

      return `Setup in progress: this Stasharr instance is configured for ${this.labelFor(catalogProvider)}. Save and test Stash and Whisparr to finish setup, or reset catalog setup to choose a different provider.`;
    }

    return 'Setup in progress: choose the catalog provider for this Stasharr instance, then save and test Stash and Whisparr.';
  }

  protected catalogProviderHelp(type: IntegrationType): string | null {
    if (!this.isCatalogProvider(type)) {
      return null;
    }

    if (this.catalogProvider() === type) {
      if (!this.catalogProviderReady()) {
        if (this.catalogProviderNeedsRepair()) {
          return `${this.labelFor(type)} remains locked in as this instance's catalog provider even while unhealthy. Repair it below or reset catalog setup before choosing a different provider.`;
        }

        return `${this.labelFor(type)} is locked in as this instance's catalog provider, but it has not passed a test yet. Test or repair it below, or reset catalog setup before choosing a different provider.`;
      }

      return `${this.labelFor(type)} is locked in as this instance's catalog provider. /scenes, performers, studios, requests, and indexing will use it.`;
    }

    return `Choose ${this.labelFor(type)} for this Stasharr instance. Saving and testing it will lock it in; changing provider type later requires resetting catalog setup and running setup again.`;
  }

  protected statusText(type: IntegrationType): string {
    const integration = this.integrations()[type];
    if (!integration || !hasSavedIntegrationConfig(integration)) {
      return 'NOT CONFIGURED';
    }

    if (!integration.enabled) {
      return 'DISABLED';
    }

    if (integration.status === 'ERROR') {
      return 'ERROR';
    }

    return isIntegrationReady(integration) ? 'READY' : 'SAVED, NOT TESTED';
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
        switchMap((integration) =>
          forkJoin({
            setupStatus: this.setupService.getStatus(),
            integrations: this.integrationsService.getIntegrations(),
          }).pipe(
            map(({ setupStatus, integrations }) => ({
              integration,
              setupStatus,
              integrations,
            })),
          ),
        ),
        finalize(() => {
          this.patchActionState(this.saveState, type, { running: false });
        }),
      )
      .subscribe({
        next: ({ integration, setupStatus, integrations }) => {
          this.status.set(setupStatus);
          this.applyIntegrations(integrations);
          const message = this.describeSaveSuccess(type, integration);
          this.notifications.success(message);
          this.patchActionState(this.saveState, type, {
            success: message,
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
        switchMap((integration) =>
          forkJoin({
            status: this.setupService.getStatus(),
            integrations: this.integrationsService.getIntegrations(),
          }).pipe(
            map(({ status, integrations }) => ({
              integration,
              status,
              integrations,
            })),
          ),
        ),
        finalize(() => {
          this.patchActionState(this.testState, type, { running: false });
        }),
      )
      .subscribe({
        next: ({ integration, status, integrations }) => {
          this.status.set(status);
          this.applyIntegrations(integrations);

          if (integration.status === 'CONFIGURED') {
            const message = `${this.labelFor(type)} test passed.`;
            this.notifications.success(message);
            this.patchActionState(this.testState, type, {
              success: message,
              error: null,
            });

            if (status.setupComplete) {
              void this.router.navigateByUrl('/scenes');
            }
            return;
          }

          const message =
            integration.lastErrorMessage?.trim() || `${this.labelFor(type)} test failed.`;
          this.notifications.error(message);
          this.patchActionState(this.testState, type, {
            success: null,
            error: message,
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

  private catalogProviderNeedsRepair(): boolean {
    const catalogProvider = this.catalogProvider();
    if (!catalogProvider) {
      return false;
    }

    return this.integrations()[catalogProvider]?.status === 'ERROR';
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

  private describeSaveSuccess(
    type: IntegrationType,
    integration: IntegrationResponse,
  ): string {
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
