import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SetupService } from '../api/setup.service';

export const requireSetupCompleteGuard: CanActivateFn = (_route, state) => {
  const setupService = inject(SetupService);
  const router = inject(Router);

  return setupService.getStatus().pipe(
    map((status) =>
      status.setupComplete || isSettingsUrl(state.url) ? true : router.createUrlTree(['/setup']),
    ),
    catchError(() => of(router.createUrlTree(['/setup']))),
  );
};

export const setupOnlyWhenIncompleteGuard: CanActivateFn = () => {
  const setupService = inject(SetupService);
  const router = inject(Router);

  return setupService.getStatus().pipe(
    map((status) => (status.setupComplete ? router.createUrlTree(['/scenes']) : true)),
    catchError(() => of(true)),
  );
};

function isSettingsUrl(url: string): boolean {
  return url === '/settings' || url.startsWith('/settings/');
}
