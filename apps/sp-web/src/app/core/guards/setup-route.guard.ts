import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { SetupService } from '../api/setup.service';

export const requireSetupCompleteGuard: CanActivateFn = () => {
  const setupService = inject(SetupService);
  const router = inject(Router);

  return setupService.getStatus().pipe(
    map((status) =>
      status.setupComplete ? true : router.createUrlTree(['/setup']),
    ),
    catchError(() => of(router.createUrlTree(['/setup']))),
  );
};

export const setupOnlyWhenIncompleteGuard: CanActivateFn = () => {
  const setupService = inject(SetupService);
  const router = inject(Router);

  return setupService.getStatus().pipe(
    map((status) =>
      status.setupComplete ? router.createUrlTree(['/discover']) : true,
    ),
    catchError(() => of(true)),
  );
};
