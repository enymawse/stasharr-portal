import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { IndexingStatusResponse, ManualIndexingSyncJob } from './indexing.types';

@Injectable({
  providedIn: 'root',
})
export class IndexingService {
  private readonly http = inject(HttpClient);

  getStatus(): Observable<IndexingStatusResponse> {
    return this.http.get<IndexingStatusResponse>('/api/indexing/status');
  }

  sync(job: ManualIndexingSyncJob = 'all'): Observable<IndexingStatusResponse> {
    const params = new HttpParams().set('job', job);
    return this.http.post<IndexingStatusResponse>('/api/indexing/sync', null, { params });
  }
}
