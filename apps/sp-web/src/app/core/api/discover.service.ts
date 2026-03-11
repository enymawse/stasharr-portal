import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DiscoverResponse } from './discover.types';

@Injectable({
  providedIn: 'root',
})
export class DiscoverService {
  private readonly http = inject(HttpClient);

  getDiscoverFeed(): Observable<DiscoverResponse> {
    return this.http.get<DiscoverResponse>('/api/discover');
  }
}
