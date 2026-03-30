import { TestBed } from '@angular/core/testing';
import {
  GuardResult,
  Router,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { firstValueFrom, isObservable, of, throwError } from 'rxjs';
import { SetupService } from '../api/setup.service';
import {
  requireSetupCompleteGuard,
  setupOnlyWhenIncompleteGuard,
} from './setup-route.guard';

describe('setup route guards', () => {
  let router: Router;
  let setupService: { getStatus: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    setupService = {
      getStatus: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: SetupService,
          useValue: setupService,
        },
      ],
    });

    router = TestBed.inject(Router);
  });

  it('redirects protected routes to /setup when setup is incomplete', async () => {
    setupService.getStatus.mockReturnValue(
      of({
        setupComplete: false,
        required: { stash: false, stashdb: false, whisparr: false },
      }),
    );

    const result = await runGuard(requireSetupCompleteGuard);

    expect(router.serializeUrl(result as UrlTree)).toBe('/setup');
  });

  it('allows protected routes when setup is complete', async () => {
    setupService.getStatus.mockReturnValue(
      of({
        setupComplete: true,
        required: { stash: true, stashdb: true, whisparr: true },
      }),
    );

    const result = await runGuard(requireSetupCompleteGuard);

    expect(result).toBe(true);
  });

  it('redirects /setup to /scenes when setup is complete', async () => {
    setupService.getStatus.mockReturnValue(
      of({
        setupComplete: true,
        required: { stash: true, stashdb: true, whisparr: true },
      }),
    );

    const result = await runGuard(setupOnlyWhenIncompleteGuard);

    expect(router.serializeUrl(result as UrlTree)).toBe('/scenes');
  });

  it('allows /setup when setup status check fails', async () => {
    setupService.getStatus.mockReturnValue(
      throwError(() => new Error('status unavailable')),
    );

    const result = await runGuard(setupOnlyWhenIncompleteGuard);

    expect(result).toBe(true);
  });
});

async function runGuard(
  guard: typeof requireSetupCompleteGuard,
): Promise<GuardResult> {
  const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never));

  if (isObservable(result)) {
    return firstValueFrom(result);
  }

  return result;
}
