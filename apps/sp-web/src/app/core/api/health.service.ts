import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { HealthStatusResponse } from './health.types';

@Injectable({
  providedIn: 'root',
})
export class HealthService {
  private readonly http = inject(HttpClient);

  getStatus(): Observable<HealthStatusResponse> {
    return this.http.get<HealthStatusResponse>('/api/v1/status');
  }
}
