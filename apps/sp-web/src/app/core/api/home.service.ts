import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  HomeRailContentResponse,
  HomeRailConfig,
  SaveHomeRailPayload,
  UpdateHomeRailsPayload,
} from './home.types';

@Injectable({
  providedIn: 'root',
})
export class HomeService {
  private readonly http = inject(HttpClient);

  getRails(): Observable<HomeRailConfig[]> {
    return this.http.get<HomeRailConfig[]>('/api/home/rails');
  }

  getRailItems(id: string): Observable<HomeRailContentResponse> {
    return this.http.get<HomeRailContentResponse>(
      `/api/home/rails/${encodeURIComponent(id)}/items`,
    );
  }

  updateRails(payload: UpdateHomeRailsPayload): Observable<HomeRailConfig[]> {
    return this.http.put<HomeRailConfig[]>('/api/home/rails', payload);
  }

  createRail(payload: SaveHomeRailPayload): Observable<HomeRailConfig> {
    return this.http.post<HomeRailConfig>('/api/home/rails', payload);
  }

  updateRail(id: string, payload: SaveHomeRailPayload): Observable<HomeRailConfig> {
    return this.http.patch<HomeRailConfig>(`/api/home/rails/${encodeURIComponent(id)}`, payload);
  }

  deleteRail(id: string): Observable<void> {
    return this.http.delete<void>(`/api/home/rails/${encodeURIComponent(id)}`);
  }
}
