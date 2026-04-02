import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { forkJoin, merge, of, switchMap, timer } from 'rxjs';
import { catchError, filter } from 'rxjs/operators';
import { RuntimeHealthService } from '../../core/api/runtime-health.service';
import {
  RuntimeHealthResponse,
  summarizeRuntimeDegradedState,
} from '../../core/api/runtime-health.types';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
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
export class AppShellLayoutComponent implements OnInit {
  private static readonly RUNTIME_HEALTH_POLL_INTERVAL_MS = 30_000;
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly setupService = inject(SetupService);
  private readonly runtimeHealthService = inject(RuntimeHealthService);
  private readonly setupStatusStore = inject(SetupStatusStore);

  protected readonly collapsed = signal(false);
  protected readonly runtimeHealth = signal<RuntimeHealthResponse | null>(null);
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
    merge(
      of(null),
      this.runtimeHealthService.refreshRequested$,
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      ),
      timer(
        AppShellLayoutComponent.RUNTIME_HEALTH_POLL_INTERVAL_MS,
        AppShellLayoutComponent.RUNTIME_HEALTH_POLL_INTERVAL_MS,
      ),
    )
      .pipe(
        switchMap(() =>
          forkJoin({
            setupStatus: this.setupService.getStatus().pipe(catchError(() => of(null))),
            runtimeHealth: this.runtimeHealthService
              .refreshStatus()
              .pipe(catchError(() => of(null))),
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ setupStatus, runtimeHealth }) => {
        if (setupStatus) {
          this.setupStatusStore.sync(setupStatus);
        }

        if (runtimeHealth) {
          this.runtimeHealth.set(runtimeHealth);
        }
      });
  }

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
  }
}
