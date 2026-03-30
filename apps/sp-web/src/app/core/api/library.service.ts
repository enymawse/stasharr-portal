import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  LibrarySceneSort,
  LibraryScenesFeedResponse,
  LibrarySortDirection,
  LibraryStudioOption,
  LibraryTagMatchMode,
  LibraryTagOption,
} from './library.types';

@Injectable({
  providedIn: 'root',
})
export class LibraryService {
  private readonly http = inject(HttpClient);

  getScenesFeed(
    page: number,
    perPage: number,
    filters?: {
      query?: string;
      sort?: LibrarySceneSort;
      direction?: LibrarySortDirection;
      tagIds?: string[];
      tagMode?: LibraryTagMatchMode;
      studioIds?: string[];
      favoritePerformersOnly?: boolean;
      favoriteStudiosOnly?: boolean;
      favoriteTagsOnly?: boolean;
    },
  ): Observable<LibraryScenesFeedResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    if (filters?.query) {
      params = params.set('query', filters.query);
    }
    if (filters?.sort) {
      params = params.set('sort', filters.sort);
    }
    if (filters?.direction) {
      params = params.set('direction', filters.direction);
    }
    if (filters?.tagIds && filters.tagIds.length > 0) {
      params = params.set('tagIds', filters.tagIds.join(','));
    }
    if (filters?.tagMode) {
      params = params.set('tagMode', filters.tagMode);
    }
    if (filters?.studioIds && filters.studioIds.length > 0) {
      params = params.set('studioIds', filters.studioIds.join(','));
    }
    if (filters?.favoritePerformersOnly) {
      params = params.set('favoritePerformersOnly', 'true');
    }
    if (filters?.favoriteStudiosOnly) {
      params = params.set('favoriteStudiosOnly', 'true');
    }
    if (filters?.favoriteTagsOnly) {
      params = params.set('favoriteTagsOnly', 'true');
    }

    return this.http.get<LibraryScenesFeedResponse>('/api/library/scenes', { params });
  }

  searchTags(query: string): Observable<LibraryTagOption[]> {
    return this.http.get<LibraryTagOption[]>('/api/library/tags', {
      params: new HttpParams().set('query', query),
    });
  }

  searchStudios(query: string): Observable<LibraryStudioOption[]> {
    return this.http.get<LibraryStudioOption[]>('/api/library/studios', {
      params: new HttpParams().set('query', query),
    });
  }
}
