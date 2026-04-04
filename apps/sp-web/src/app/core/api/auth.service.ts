import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { AuthStateStore } from './auth-state.store';
import {
  type AuthStatusResponse,
  type BootstrapAdminPayload,
  type ChangePasswordPayload,
  type LoginPayload,
} from './auth.types';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly authStateStore = inject(AuthStateStore);

  readonly status = this.authStateStore.status;

  refreshStatus(): Observable<AuthStatusResponse> {
    return this.http
      .get<AuthStatusResponse>('/api/auth/status')
      .pipe(tap((status) => this.authStateStore.sync(status)));
  }

  bootstrap(payload: BootstrapAdminPayload): Observable<AuthStatusResponse> {
    return this.http
      .post<AuthStatusResponse>('/api/auth/bootstrap', payload)
      .pipe(tap((status) => this.authStateStore.sync(status)));
  }

  login(payload: LoginPayload): Observable<AuthStatusResponse> {
    return this.http
      .post<AuthStatusResponse>('/api/auth/login', payload)
      .pipe(tap((status) => this.authStateStore.sync(status)));
  }

  logout(): Observable<AuthStatusResponse> {
    return this.http
      .post<AuthStatusResponse>('/api/auth/logout', {})
      .pipe(tap((status) => this.authStateStore.sync(status)));
  }

  changePassword(payload: ChangePasswordPayload): Observable<void> {
    return this.http.post<void>('/api/auth/change-password', payload);
  }

  clearStatus(): void {
    this.authStateStore.clear();
  }
}
