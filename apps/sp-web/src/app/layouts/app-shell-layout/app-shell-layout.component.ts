import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
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

interface ShellNavItem {
  label: string;
  route: string;
  icon: string;
  exact: boolean;
  activePrefixes?: readonly string[];
}

const HOME_NAV_ITEM: ShellNavItem = {
  label: 'Home',
  route: '/home',
  icon: 'pi pi-home',
  exact: true,
};

const SCENES_NAV_ITEM: ShellNavItem = {
  label: 'Scenes',
  route: '/scenes',
  icon: 'pi pi-video',
  exact: false,
  activePrefixes: ['/scenes', '/scene/'],
};

const ACQUISITION_NAV_ITEM: ShellNavItem = {
  label: 'Acquisition',
  route: '/acquisition',
  icon: 'pi pi-inbox',
  exact: true,
};

const LIBRARY_NAV_ITEM: ShellNavItem = {
  label: 'Library',
  route: '/library',
  icon: 'pi pi-folder-open',
  exact: true,
};

const PERFORMERS_NAV_ITEM: ShellNavItem = {
  label: 'Performers',
  route: '/performers',
  icon: 'pi pi-users',
  exact: false,
  activePrefixes: ['/performers', '/performer/'],
};

const STUDIOS_NAV_ITEM: ShellNavItem = {
  label: 'Studios',
  route: '/studios',
  icon: 'pi pi-building',
  exact: false,
  activePrefixes: ['/studios', '/studio/'],
};

const SETTINGS_NAV_ITEM: ShellNavItem = {
  label: 'Settings',
  route: '/settings',
  icon: 'pi pi-cog',
  exact: false,
};

const DESKTOP_NAV_ITEMS: readonly ShellNavItem[] = [
  HOME_NAV_ITEM,
  SCENES_NAV_ITEM,
  ACQUISITION_NAV_ITEM,
  LIBRARY_NAV_ITEM,
  PERFORMERS_NAV_ITEM,
  STUDIOS_NAV_ITEM,
  SETTINGS_NAV_ITEM,
];

const MOBILE_PRIMARY_NAV_ITEMS: readonly ShellNavItem[] = [
  HOME_NAV_ITEM,
  SCENES_NAV_ITEM,
  ACQUISITION_NAV_ITEM,
  LIBRARY_NAV_ITEM,
];

const MOBILE_SECONDARY_NAV_ITEMS: readonly ShellNavItem[] = [
  PERFORMERS_NAV_ITEM,
  STUDIOS_NAV_ITEM,
  SETTINGS_NAV_ITEM,
];

@Component({
  selector: 'app-shell-layout',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './app-shell-layout.component.html',
  styleUrl: './app-shell-layout.component.scss',
})
export class AppShellLayoutComponent implements OnInit, OnDestroy {
  private static readonly SETUP_STATUS_POLL_INTERVAL_MS = 30_000;
  private static readonly PHONE_SHELL_MEDIA_QUERY = '(max-width: 720px)';
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly setupService = inject(SetupService);
  private readonly runtimeHealthService = inject(RuntimeHealthService);
  private readonly setupStatusStore = inject(SetupStatusStore);
  private readonly notifications = inject(AppNotificationsService);
  private readonly phoneShellMediaQuery = this.createPhoneShellMediaQuery();
  private readonly phoneShellMediaChangeHandler = (event: MediaQueryListEvent) => {
    this.mobileShell.set(event.matches);
    if (!event.matches) {
      this.moreMenuOpen.set(false);
    }
  };

  protected readonly desktopNavItems = DESKTOP_NAV_ITEMS;
  protected readonly mobilePrimaryNavItems = MOBILE_PRIMARY_NAV_ITEMS;
  protected readonly mobileSecondaryNavItems = MOBILE_SECONDARY_NAV_ITEMS;
  protected readonly collapsed = signal(false);
  protected readonly mobileShell = signal(this.phoneShellMediaQuery?.matches ?? false);
  protected readonly moreMenuOpen = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly currentUrl = signal(this.router.url);
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
  protected readonly moreNavActive = computed(() => {
    const currentUrl = this.currentUrl();
    return this.mobileSecondaryNavItems.some((item) => this.matchesNavItem(item, currentUrl));
  });

  ngOnInit(): void {
    this.runtimeHealthService.ensureStarted();
    this.currentUrl.set(this.normalizeUrl(this.router.url));

    if (this.phoneShellMediaQuery) {
      this.mobileShell.set(this.phoneShellMediaQuery.matches);
      this.phoneShellMediaQuery.addEventListener('change', this.phoneShellMediaChangeHandler);
    }

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => {
        this.currentUrl.set(this.normalizeUrl(event.urlAfterRedirects));
        this.moreMenuOpen.set(false);
      });

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
    this.phoneShellMediaQuery?.removeEventListener('change', this.phoneShellMediaChangeHandler);
    this.runtimeHealthService.stop();
  }

  protected toggleCollapsed(): void {
    this.collapsed.update((value) => !value);
  }

  protected toggleMoreMenu(): void {
    this.moreMenuOpen.update((value) => !value);
  }

  protected closeMoreMenu(): void {
    this.moreMenuOpen.set(false);
  }

  protected isNavItemActive(item: ShellNavItem): boolean {
    return this.matchesNavItem(item, this.currentUrl());
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

  private createPhoneShellMediaQuery(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return null;
    }

    return window.matchMedia(AppShellLayoutComponent.PHONE_SHELL_MEDIA_QUERY);
  }

  private matchesNavItem(item: ShellNavItem, currentUrl: string): boolean {
    const normalizedUrl = this.normalizeUrl(currentUrl);
    if (item.exact) {
      return normalizedUrl === item.route;
    }

    const activePrefixes = item.activePrefixes?.length ? item.activePrefixes : [item.route];
    return activePrefixes.some((prefix) => this.matchesRoutePrefix(normalizedUrl, prefix));
  }

  private matchesRoutePrefix(url: string, prefix: string): boolean {
    if (prefix.endsWith('/')) {
      return url.startsWith(prefix);
    }

    return url === prefix || url.startsWith(`${prefix}/`);
  }

  private normalizeUrl(url: string): string {
    return url.split('?')[0]?.split('#')[0] || '/';
  }
}
