import { Injectable, signal } from '@angular/core';
import { SetupStatusResponse } from './setup.types';

@Injectable({
  providedIn: 'root',
})
export class SetupStatusStore {
  private readonly statusState = signal<SetupStatusResponse | null>(null);

  readonly status = this.statusState.asReadonly();

  sync(status: SetupStatusResponse): void {
    this.statusState.set(status);
  }
}
