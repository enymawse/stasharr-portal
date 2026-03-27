import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AcquisitionLifecycleFilter, AcquisitionScenesResponse } from './acquisition.types';

@Injectable({
  providedIn: 'root',
})
export class AcquisitionService {
  private readonly http = inject(HttpClient);

  getScenesFeed(
    page: number,
    perPage: number,
    lifecycle: AcquisitionLifecycleFilter = 'ANY',
  ): Observable<AcquisitionScenesResponse> {
    let params = new HttpParams().set('page', page.toString()).set('perPage', perPage.toString());

    if (lifecycle !== 'ANY') {
      params = params.set('lifecycle', lifecycle);
    }

    return this.http.get<AcquisitionScenesResponse>('/api/acquisition/scenes', {
      params,
    });
  }
}
