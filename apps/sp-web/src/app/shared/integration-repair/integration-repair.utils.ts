import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, FormGroup } from '@angular/forms';
import {
  IntegrationResponse,
  IntegrationType,
  UpdateIntegrationPayload,
  isCatalogProviderType,
} from '../../core/api/integrations.types';

export interface IntegrationActionState {
  running: boolean;
  success: string | null;
  error: string | null;
}

export type IntegrationForm = FormGroup<{
  name: FormControl<string>;
  baseUrl: FormControl<string>;
  apiKey: FormControl<string>;
  enabled: FormControl<boolean>;
}>;

export function createIntegrationForm(): IntegrationForm {
  return new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    baseUrl: new FormControl('', { nonNullable: true }),
    apiKey: new FormControl('', { nonNullable: true }),
    enabled: new FormControl(true, { nonNullable: true }),
  });
}

export function createEmptyIntegrationsRecord(): Record<IntegrationType, IntegrationResponse | null> {
  return {
    STASH: null,
    WHISPARR: null,
    STASHDB: null,
    FANSDB: null,
  };
}

export function mapIntegrationsByType(
  integrations: IntegrationResponse[],
): Record<IntegrationType, IntegrationResponse | null> {
  const byType = createEmptyIntegrationsRecord();

  for (const integration of integrations) {
    byType[integration.type] = integration;
  }

  return byType;
}

export function createActionState(): IntegrationActionState {
  return {
    running: false,
    success: null,
    error: null,
  };
}

export function createActionStateRecord(): Record<IntegrationType, IntegrationActionState> {
  return {
    STASH: createActionState(),
    WHISPARR: createActionState(),
    STASHDB: createActionState(),
    FANSDB: createActionState(),
  };
}

export function patchActionState(
  store: {
    update: (
      updater: (
        state: Record<IntegrationType, IntegrationActionState>,
      ) => Record<IntegrationType, IntegrationActionState>,
    ) => void;
  },
  type: IntegrationType,
  patch: Partial<IntegrationActionState>,
): void {
  store.update((current) => ({
    ...current,
    [type]: {
      ...current[type],
      ...patch,
    },
  }));
}

export function buildIntegrationPayload(
  type: IntegrationType,
  form: IntegrationForm,
): UpdateIntegrationPayload {
  const formValue = form.getRawValue();
  const payload: UpdateIntegrationPayload = {
    enabled: isCatalogProviderType(type) ? true : formValue.enabled,
    name: normalizeInput(formValue.name),
    baseUrl: normalizeInput(formValue.baseUrl),
  };

  const apiKey = normalizeInput(formValue.apiKey);
  if (apiKey) {
    payload.apiKey = apiKey;
  }

  return payload;
}

export function defaultEnabledValue(
  type: IntegrationType,
  integration: IntegrationResponse | null,
): boolean {
  if (integration) {
    return integration.enabled;
  }

  return isCatalogProviderType(type) ? false : true;
}

export function normalizeInput(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function formatOptionalDateTime(value: string | null): string | null {
  return value ? formatDateTime(value) : null;
}

export function describeMutationError(error: unknown, fallback: string): string {
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
