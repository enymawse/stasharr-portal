import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import {
  Observable,
  Subject,
  catchError,
  exhaustMap,
  finalize,
  merge,
  of,
  shareReplay,
  tap,
  timer,
} from 'rxjs';
import { RuntimeHealthResponse } from './runtime-health.types';

@Injectable({
  providedIn: 'root',
})
export class RuntimeHealthService {
  private static readonly POLL_INTERVAL_MS = 30_000;

  private readonly http = inject(HttpClient);
  private readonly refreshRequests = new Subject<void>();
  private readonly statusState = signal<RuntimeHealthResponse | null>(null);
  private inFlightRefresh$: Observable<RuntimeHealthResponse> | null = null;
  private started = false;

  readonly status = this.statusState.asReadonly();

  getStatus(): Observable<RuntimeHealthResponse> {
    return this.http
      .get<RuntimeHealthResponse>('/api/health/runtime')
      .pipe(tap((status) => this.statusState.set(status)));
  }

  refreshStatus(): Observable<RuntimeHealthResponse> {
    if (this.inFlightRefresh$) {
      return this.inFlightRefresh$;
    }

    const request$ = this.http.post<RuntimeHealthResponse>('/api/health/runtime/refresh', {}).pipe(
      tap((status) => this.statusState.set(status)),
      finalize(() => {
        this.inFlightRefresh$ = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.inFlightRefresh$ = request$;
    return request$;
  }

  ensureStarted(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    merge(
      of(void 0),
      this.refreshRequests,
      timer(RuntimeHealthService.POLL_INTERVAL_MS, RuntimeHealthService.POLL_INTERVAL_MS),
    )
      .pipe(exhaustMap(() => this.refreshStatus().pipe(catchError(() => of(null)))))
      .subscribe();
  }

  requestRefresh(): void {
    this.ensureStarted();
    this.refreshRequests.next();
  }
}
