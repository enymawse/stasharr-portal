import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthStateStore } from '../api/auth-state.store';

export const authRedirectInterceptor: HttpInterceptorFn = (request, next) => {
  const router = inject(Router);
  const authStateStore = inject(AuthStateStore);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (shouldRedirectToLogin(request.url, error)) {
        authStateStore.clear();
        if (router.url !== '/login') {
          void router.navigateByUrl('/login');
        }
      }

      return throwError(() => error);
    }),
  );
};

function shouldRedirectToLogin(url: string, error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
    return false;
  }

  return !url.includes('/api/auth/');
}
