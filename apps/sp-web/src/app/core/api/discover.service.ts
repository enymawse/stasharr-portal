import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DiscoverResponse, SceneDetails } from './discover.types';

@Injectable({
  providedIn: 'root',
})
export class DiscoverService {
  private readonly http = inject(HttpClient);

  getDiscoverFeed(page: number, perPage: number): Observable<DiscoverResponse> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('perPage', perPage.toString());
    return this.http.get<DiscoverResponse>('/api/discover', { params });
  }

  getSceneDetails(stashId: string): Observable<SceneDetails> {
    return this.http.get<SceneDetails>(
      `/api/scenes/${encodeURIComponent(stashId)}`,
    );
  }
}
