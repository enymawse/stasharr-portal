export type IntegrationType = 'STASH' | 'WHISPARR' | 'STASHDB';

export interface IntegrationResponse {
  type: IntegrationType;
  enabled: boolean;
  status: 'NOT_CONFIGURED' | 'CONFIGURED' | 'ERROR';
  name: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  lastHealthyAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

export interface UpdateIntegrationPayload {
  enabled?: boolean;
  name?: string;
  baseUrl?: string;
  apiKey?: string;
}
