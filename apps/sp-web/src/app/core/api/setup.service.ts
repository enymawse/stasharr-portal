import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SetupStatusResponse } from './setup.types';

@Injectable({
  providedIn: 'root',
})
export class SetupService {
  private readonly http = inject(HttpClient);

  getStatus(): Observable<SetupStatusResponse> {
    return this.http.get<SetupStatusResponse>('/api/setup/status');
  }
}
