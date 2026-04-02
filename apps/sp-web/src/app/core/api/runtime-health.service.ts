import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { RuntimeHealthResponse } from './runtime-health.types';

@Injectable({
  providedIn: 'root',
})
export class RuntimeHealthService {
  private readonly http = inject(HttpClient);

  getStatus(): Observable<RuntimeHealthResponse> {
    return this.http.get<RuntimeHealthResponse>('/api/health/runtime');
  }
}
