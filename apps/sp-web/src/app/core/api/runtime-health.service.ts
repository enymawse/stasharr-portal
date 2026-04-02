import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { RuntimeHealthResponse } from './runtime-health.types';

@Injectable({
  providedIn: 'root',
})
export class RuntimeHealthService {
  private readonly http = inject(HttpClient);
  private readonly refreshRequests = new Subject<void>();

  readonly refreshRequested$ = this.refreshRequests.asObservable();

  getStatus(): Observable<RuntimeHealthResponse> {
    return this.http.get<RuntimeHealthResponse>('/api/health/runtime');
  }

  refreshStatus(): Observable<RuntimeHealthResponse> {
    return this.http.post<RuntimeHealthResponse>('/api/health/runtime/refresh', {});
  }

  requestRefresh(): void {
    this.refreshRequests.next();
  }
}
