import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DiscoverResponse,
  SceneFeedSort,
  SceneTagMatchMode,
  SceneTagOption,
  SceneDetails,
  SceneRequestOptions,
  SubmitSceneRequestPayload,
  SubmitSceneRequestResponse,
} from './discover.types';

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

  getScenesFeed(
    page: number,
    perPage: number,
    sort?: SceneFeedSort,
    tagIds?: string[],
    tagMode?: SceneTagMatchMode,
  ): Observable<DiscoverResponse> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('perPage', perPage.toString());

    if (sort) {
      params = params.set('sort', sort);
    }
    if (tagIds && tagIds.length > 0) {
      params = params.set('tagIds', tagIds.join(','));
    }
    if (tagMode) {
      params = params.set('tagMode', tagMode);
    }

    return this.http.get<DiscoverResponse>('/api/scenes', { params });
  }

  searchSceneTags(query: string): Observable<SceneTagOption[]> {
    const params = new HttpParams().set('query', query);
    return this.http.get<SceneTagOption[]>('/api/scenes/tags', { params });
  }

  getRequestsFeed(page: number, perPage: number): Observable<DiscoverResponse> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('perPage', perPage.toString());
    return this.http.get<DiscoverResponse>('/api/requests', { params });
  }

  getSceneDetails(stashId: string): Observable<SceneDetails> {
    return this.http.get<SceneDetails>(
      `/api/scenes/${encodeURIComponent(stashId)}`,
    );
  }

  getSceneRequestOptions(stashId: string): Observable<SceneRequestOptions> {
    return this.http.get<SceneRequestOptions>(
      `/api/requests/${encodeURIComponent(stashId)}/options`,
    );
  }

  submitSceneRequest(
    stashId: string,
    payload: SubmitSceneRequestPayload,
  ): Observable<SubmitSceneRequestResponse> {
    return this.http.post<SubmitSceneRequestResponse>(
      `/api/requests/${encodeURIComponent(stashId)}`,
      payload,
    );
  }
}
