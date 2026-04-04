import { Injectable, signal } from '@angular/core';
import { AuthStatusResponse } from './auth.types';

@Injectable({
  providedIn: 'root',
})
export class AuthStateStore {
  private readonly statusState = signal<AuthStatusResponse | null>(null);

  readonly status = this.statusState.asReadonly();

  sync(status: AuthStatusResponse): void {
    this.statusState.set(status);
  }

  clear(): void {
    this.statusState.set(null);
  }
}
