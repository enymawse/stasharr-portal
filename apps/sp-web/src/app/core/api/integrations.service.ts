import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  IntegrationResponse,
  IntegrationTestResponse,
  IntegrationType,
  UpdateIntegrationPayload,
} from './integrations.types';

@Injectable({
  providedIn: 'root',
})
export class IntegrationsService {
  private readonly http = inject(HttpClient);

  getIntegrations(): Observable<IntegrationResponse[]> {
    return this.http.get<IntegrationResponse[]>('/api/integrations');
  }

  updateIntegration(
    type: IntegrationType,
    payload: UpdateIntegrationPayload,
  ): Observable<IntegrationResponse> {
    return this.http.put<IntegrationResponse>(`/api/integrations/${type}`, payload);
  }

  testIntegration(
    type: IntegrationType,
    payload: UpdateIntegrationPayload,
  ): Observable<IntegrationTestResponse> {
    return this.http.post<IntegrationTestResponse>(
      `/api/integrations/${type}/test`,
      payload,
    );
  }

  resetIntegration(type: IntegrationType): Observable<IntegrationResponse> {
    return this.http.delete<IntegrationResponse>(`/api/integrations/${type}`);
  }

  resetAllIntegrations(): Observable<IntegrationResponse[]> {
    return this.http.delete<IntegrationResponse[]>('/api/integrations');
  }
}
