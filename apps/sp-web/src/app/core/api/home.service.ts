import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { HomeRailConfig, UpdateHomeRailsPayload } from './home.types';

@Injectable({
  providedIn: 'root',
})
export class HomeService {
  private readonly http = inject(HttpClient);

  getRails(): Observable<HomeRailConfig[]> {
    return this.http.get<HomeRailConfig[]>('/api/home/rails');
  }

  updateRails(payload: UpdateHomeRailsPayload): Observable<HomeRailConfig[]> {
    return this.http.put<HomeRailConfig[]>('/api/home/rails', payload);
  }
}
