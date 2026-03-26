import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  DiscoverResponse,
  PerformerDetails,
  PerformerFeedResponse,
  PerformerGender,
  PerformerSort,
  PerformerStudioOption,
  FavoriteMutationResponse,
  StudioFeedResponse,
  StudioFeedSort,
  SceneFavoritesFilter,
  SceneFeedSort,
  SortDirection,
  SceneTagMatchMode,
  SceneTagOption,
  SceneDetails,
  SceneLibraryAvailability,
  SceneRequestOptions,
  ScenesFeedResponse,
  SubmitSceneRequestPayload,
  SubmitSceneRequestResponse,
  StudioDetails,
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
    direction?: SortDirection,
    tagIds?: string[],
    tagMode?: SceneTagMatchMode,
    favorites?: SceneFavoritesFilter,
    studioIds?: string[],
    libraryAvailability?: SceneLibraryAvailability,
    stashFavoritePerformersOnly?: boolean,
    stashFavoriteStudiosOnly?: boolean,
    stashFavoriteTagsOnly?: boolean,
  ): Observable<ScenesFeedResponse> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('perPage', perPage.toString());

    if (sort) {
      params = params.set('sort', sort);
    }
    if (direction) {
      params = params.set('direction', direction);
    }
    if (tagIds && tagIds.length > 0) {
      params = params.set('tagIds', tagIds.join(','));
    }
    if (tagMode) {
      params = params.set('tagMode', tagMode);
    }
    if (favorites) {
      params = params.set('favorites', favorites);
    }
    if (studioIds && studioIds.length > 0) {
      params = params.set('studioIds', studioIds.join(','));
    }
    if (libraryAvailability) {
      params = params.set('libraryAvailability', libraryAvailability);
    }
    if (stashFavoritePerformersOnly) {
      params = params.set('stashFavoritePerformersOnly', '1');
    }
    if (stashFavoriteStudiosOnly) {
      params = params.set('stashFavoriteStudiosOnly', '1');
    }
    if (stashFavoriteTagsOnly) {
      params = params.set('stashFavoriteTagsOnly', '1');
    }

    return this.http.get<ScenesFeedResponse>('/api/scenes', { params });
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

  getPerformersFeed(
    page: number,
    perPage: number,
    filters?: {
      name?: string;
      gender?: PerformerGender;
      sort?: PerformerSort;
      direction?: SortDirection;
      favoritesOnly?: boolean;
    },
  ): Observable<PerformerFeedResponse> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('perPage', perPage.toString());

    if (filters?.name) {
      params = params.set('name', filters.name);
    }
    if (filters?.gender) {
      params = params.set('gender', filters.gender);
    }
    if (filters?.sort) {
      params = params.set('sort', filters.sort);
    }
    if (filters?.direction) {
      params = params.set('direction', filters.direction);
    }
    if (filters?.favoritesOnly) {
      params = params.set('favoritesOnly', 'true');
    }
    return this.http.get<PerformerFeedResponse>('/api/performers', { params });
  }

  getPerformerDetails(performerId: string): Observable<PerformerDetails> {
    return this.http.get<PerformerDetails>(
      `/api/performers/${encodeURIComponent(performerId)}`,
    );
  }

  getPerformerScenesFeed(
    performerId: string,
    page: number,
    perPage: number,
    filters?: {
      sort?: SceneFeedSort;
      direction?: SortDirection;
      studioIds?: string[];
      tagIds?: string[];
      onlyFavoriteStudios?: boolean;
    },
  ): Observable<DiscoverResponse> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('perPage', perPage.toString());

    if (filters?.sort) {
      params = params.set('sort', filters.sort);
    }
    if (filters?.direction) {
      params = params.set('direction', filters.direction);
    }
    if (filters?.studioIds && filters.studioIds.length > 0) {
      params = params.set('studioIds', filters.studioIds.join(','));
    }
    if (filters?.tagIds && filters.tagIds.length > 0) {
      params = params.set('tagIds', filters.tagIds.join(','));
    }
    if (filters?.onlyFavoriteStudios) {
      params = params.set('onlyFavoriteStudios', 'true');
    }

    return this.http.get<DiscoverResponse>(
      `/api/performers/${encodeURIComponent(performerId)}/scenes`,
      { params },
    );
  }

  searchPerformerStudios(query: string): Observable<PerformerStudioOption[]> {
    const params = new HttpParams().set('query', query);
    return this.http.get<PerformerStudioOption[]>('/api/performers/studios', {
      params,
    });
  }

  favoritePerformer(
    performerId: string,
    favorite: boolean,
  ): Observable<FavoriteMutationResponse> {
    return this.http.post<FavoriteMutationResponse>(
      `/api/performers/${encodeURIComponent(performerId)}/favorite`,
      { favorite },
    );
  }

  favoriteStudio(
    studioId: string,
    favorite: boolean,
  ): Observable<FavoriteMutationResponse> {
    return this.http.post<FavoriteMutationResponse>(
      `/api/scenes/studios/${encodeURIComponent(studioId)}/favorite`,
      { favorite },
    );
  }

  getStudiosFeed(
    page: number,
    perPage: number,
    filters?: {
      name?: string;
      sort?: StudioFeedSort;
      direction?: SortDirection;
      favoritesOnly?: boolean;
    },
  ): Observable<StudioFeedResponse> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('perPage', perPage.toString());

    if (filters?.name) {
      params = params.set('name', filters.name);
    }
    if (filters?.sort) {
      params = params.set('sort', filters.sort);
    }
    if (filters?.direction) {
      params = params.set('direction', filters.direction);
    }
    if (filters?.favoritesOnly) {
      params = params.set('favoritesOnly', 'true');
    }

    return this.http.get<StudioFeedResponse>('/api/studios', { params });
  }

  getStudioDetails(studioId: string): Observable<StudioDetails> {
    return this.http.get<StudioDetails>(
      `/api/studios/${encodeURIComponent(studioId)}`,
    );
  }
}
