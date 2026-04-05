import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { finalize, merge, of, switchMap, timer } from 'rxjs';
import { catchError, filter } from 'rxjs/operators';
import { AuthService } from '../../core/api/auth.service';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import { summarizeRuntimeDegradedState } from '../../core/api/runtime-health.types';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { summarizeDegradedSetupState } from '../../core/api/setup.types';

interface ShellDegradedState {
  kind: 'setup' | 'runtime';
  eyebrow: string;
  message: string;
}

@Component({
  selector: 'app-shell-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app-shell-layout.component.html',
  styleUrl: './app-shell-layout.component.scss',
})
export class AppShellLayoutComponent implements OnInit, OnDestroy {
  private static readonly SETUP_STATUS_POLL_INTERVAL_MS = 30_000;
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly setupService = inject(SetupService);
  private readonly runtimeHealthService = inject(RuntimeHealthService);
  private readonly setupStatusStore = inject(SetupStatusStore);
  private readonly notifications = inject(AppNotificationsService);

  protected readonly collapsed = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly authStatus = this.authService.status;
  protected readonly runtimeHealth = this.runtimeHealthService.status;
  protected readonly degradedState = computed<ShellDegradedState | null>(() => {
    const setupState = summarizeDegradedSetupState(this.setupStatusStore.status());
    if (setupState) {
      return {
        kind: 'setup',
        eyebrow: 'Repair needed',
        message: setupState.message,
      };
    }

    const runtimeState = summarizeRuntimeDegradedState(
      this.runtimeHealth(),
      this.setupStatusStore.status()?.catalogProvider ?? null,
    );
    if (!runtimeState) {
      return null;
    }

    return {
      kind: 'runtime',
      eyebrow: 'Runtime outage',
      message: runtimeState.message,
    };
  });

  ngOnInit(): void {
    this.runtimeHealthService.ensureStarted();

    merge(
      of(null),
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      ),
      timer(
        AppShellLayoutComponent.SETUP_STATUS_POLL_INTERVAL_MS,
        AppShellLayoutComponent.SETUP_STATUS_POLL_INTERVAL_MS,
      ),
    )
      .pipe(
        switchMap(() => this.setupService.getStatus().pipe(catchError(() => of(null)))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((setupStatus) => {
        if (!setupStatus) {
          return;
        }

        this.setupStatusStore.sync(setupStatus);
      });
  }

  ngOnDestroy(): void {
    this.runtimeHealthService.stop();
  }

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
  }

  protected logout(): void {
    if (this.loggingOut()) {
      return;
    }

    this.loggingOut.set(true);

    this.authService
      .logout()
      .pipe(
        finalize(() => {
          this.loggingOut.set(false);
        }),
      )
      .subscribe({
        next: () => {
          this.notifications.info('Signed out');
          void this.router.navigateByUrl('/login');
        },
        error: () => {
          this.authService.clearStatus();
          void this.router.navigateByUrl('/login');
        },
      });
  }
}
