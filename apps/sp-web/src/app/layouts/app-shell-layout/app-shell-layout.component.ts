import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { EMPTY, merge, of, switchMap, timer } from 'rxjs';
import { catchError, filter } from 'rxjs/operators';
import { SetupService } from '../../core/api/setup.service';
import { SetupStatusStore } from '../../core/api/setup-status.store';
import { summarizeDegradedSetupState } from '../../core/api/setup.types';

@Component({
  selector: 'app-shell-layout',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app-shell-layout.component.html',
  styleUrl: './app-shell-layout.component.scss',
})
export class AppShellLayoutComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly setupService = inject(SetupService);
  private readonly setupStatusStore = inject(SetupStatusStore);

  protected readonly collapsed = signal(false);
  protected readonly degradedState = computed(() =>
    summarizeDegradedSetupState(this.setupStatusStore.status()),
  );

  ngOnInit(): void {
    merge(
      of(null),
      this.router.events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      ),
      timer(60_000, 60_000),
    )
      .pipe(
        switchMap(() =>
          this.setupService.getStatus().pipe(catchError(() => EMPTY)),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((status) => this.setupStatusStore.sync(status));
  }

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
  }
}
