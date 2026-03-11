import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { DiscoverItem } from './discover.types';

@Injectable({
  providedIn: 'root',
})
export class DiscoverService {
  private readonly http = inject(HttpClient);

  getDiscoverFeed(): Observable<DiscoverItem[]> {
    return this.http.get<DiscoverItem[]>('/api/discover');
  }
}
