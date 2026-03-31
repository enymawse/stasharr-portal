import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subscription, combineLatest, finalize } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { DiscoverService } from '../../core/api/discover.service';
import { integrationLabel } from '../../core/api/integrations.types';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import {
  SceneDetails,
  ScenePerformer,
  SceneRequestContext,
  isSceneStatusRequestable,
} from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

interface SceneLifecycleStep {
  system: string;
  title: string;
  detail: string;
  tone: 'complete' | 'active' | 'pending';
}

@Component({
  selector: 'app-scene-page',
  imports: [
    RouterLink,
    FormsModule,
    Message,
    ProgressSpinner,
    Select,
    ButtonDirective,
    SceneStatusBadgeComponent,
    SceneRequestModalComponent,
  ],
  templateUrl: './scene-page.component.html',
  styleUrl: './scene-page.component.scss',
})
export class ScenePageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly discoverService = inject(DiscoverService);
  private readonly notifications = inject(AppNotificationsService);
  private previousFocusedElement: HTMLElement | null = null;
  private routeSubscription: Subscription | null = null;

  @ViewChild('requestTriggerButton')
  private requestTriggerButton?: ElementRef<HTMLButtonElement>;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly scene = signal<SceneDetails | null>(null);
  protected readonly descriptionExpanded = signal(false);
  protected readonly selectedStashCopyUrl = signal<string | null>(null);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);
  protected readonly favoritingStudio = signal(false);
  protected readonly performerFavoriteInFlightById = signal<Record<string, boolean>>({});
  protected readonly backLinkPath = signal('/scenes');
  protected readonly backLinkQueryParams = signal<Params>({});
  protected readonly backLinkLabel = signal('Back to Scenes');

  ngOnInit(): void {
    this.routeSubscription = combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
    ]).subscribe(([paramMap, queryParamMap]) => {
      const resolvedBackLink = this.parseReturnTo(queryParamMap.get('returnTo'), '/scenes');
      this.backLinkPath.set(resolvedBackLink.path);
      this.backLinkQueryParams.set(resolvedBackLink.queryParams);
      this.backLinkLabel.set(this.backLinkText(resolvedBackLink.path, 'Back to Scenes'));

      const stashIdParam = paramMap.get('stashId')?.trim();
      if (!stashIdParam) {
        this.error.set('Scene id is missing from the route.');
        this.loading.set(false);
        return;
      }

      this.loadScene(stashIdParam);
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  protected retry(): void {
    this.loadSceneByRoute();
  }

  protected toggleDescription(): void {
    this.descriptionExpanded.update((value) => !value);
  }

  protected hasStashCopy(scene: SceneDetails): boolean {
    return scene.stash?.exists === true && scene.stash.copies.length > 0;
  }

  protected hasMultipleStashCopies(scene: SceneDetails): boolean {
    return scene.stash?.hasMultipleCopies === true;
  }

  protected hasWhisparrLink(scene: SceneDetails): boolean {
    return scene.whisparr?.exists === true && scene.whisparr.viewUrl.length > 0;
  }

  protected selectedStashViewUrl(scene: SceneDetails): string | null {
    const selected = this.selectedStashCopyUrl();
    if (selected) {
      return selected;
    }

    return scene.stash?.copies[0]?.viewUrl ?? null;
  }

  protected selectedStashLabel(scene: SceneDetails): string {
    const selected = this.selectedStashViewUrl(scene);
    if (!selected) {
      return 'View in Stash';
    }

    return scene.stash?.copies.find((copy) => copy.viewUrl === selected)?.label ?? 'View in Stash';
  }

  protected onStashCopySelected(viewUrl: string | null | undefined): void {
    this.selectedStashCopyUrl.set(viewUrl ?? null);
  }

  protected studioLogoAriaLabel(scene: SceneDetails): string {
    const studioName = scene.studio?.trim();
    if (studioName) {
      return `Open ${studioName} in a new tab`;
    }

    return 'Open studio in a new tab';
  }

  protected formattedDuration(durationSeconds: number | null): string | null {
    if (!durationSeconds || durationSeconds <= 0) {
      return null;
    }

    const minutes = Math.floor(durationSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = Math.floor(durationSeconds % 60)
      .toString()
      .padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  protected hasLongDescription(description: string | null): boolean {
    if (!description) {
      return false;
    }

    return this.normalizeDescription(description).length > 360;
  }

  protected displayedDescription(description: string | null): string | null {
    if (!description) {
      return null;
    }

    const normalized = this.normalizeDescription(description);
    if (this.descriptionExpanded() || normalized.length <= 360) {
      return normalized;
    }

    return `${normalized.slice(0, 357)}...`;
  }

  protected performerInitial(name: string): string {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '?';
  }

  protected formattedGender(gender: string | null): string | null {
    if (!gender || gender.trim().length === 0) {
      return null;
    }

    return gender;
  }

  protected lifecycleSummary(scene: SceneDetails): string {
    const providerLabel = integrationLabel(scene.source);

    switch (scene.status.state) {
      case 'REQUESTED':
        return 'Requested in Whisparr and waiting for acquisition to begin.';
      case 'DOWNLOADING':
        return 'Whisparr is actively acquiring this scene.';
      case 'IMPORT_PENDING':
        return 'Whisparr has the file, but Stash has not imported it yet.';
      case 'AVAILABLE':
        return 'Imported into Stash and available in your local library.';
      case 'FAILED':
        return 'The last known acquisition attempt failed in Whisparr. Resolve or retry this download in Whisparr.';
      case 'NOT_REQUESTED':
      default:
        return `Discovered in ${providerLabel} and not yet sent into your local acquisition pipeline.`;
    }
  }

  protected lifecycleSteps(scene: SceneDetails): SceneLifecycleStep[] {
    const providerLabel = integrationLabel(scene.source);

    return [
      {
        system: providerLabel,
        title: 'Discovered',
        detail: `Metadata, credits, and source links on this page come from ${providerLabel}.`,
        tone: 'complete',
      },
      this.whisparrLifecycleStep(scene),
      this.stashLifecycleStep(scene),
    ];
  }

  protected canRequestScene(scene: SceneDetails): boolean {
    return isSceneStatusRequestable(scene.status);
  }

  protected failedRemediationVisible(scene: SceneDetails): boolean {
    return scene.status.state === 'FAILED';
  }

  protected canToggleFavoriteStudio(scene: SceneDetails): boolean {
    if (!scene.studioId) {
      return false;
    }

    return !this.favoritingStudio();
  }

  protected studioFavoriteAriaLabel(scene: SceneDetails): string {
    const studioName = scene.studio?.trim();
    if (studioName) {
      return scene.studioIsFavorite
        ? `Unfavorite studio ${studioName}`
        : `Favorite studio ${studioName}`;
    }

    return scene.studioIsFavorite ? 'Unfavorite studio' : 'Favorite studio';
  }

  protected studioFavoriteTitle(scene: SceneDetails): string {
    return this.studioFavoriteAriaLabel(scene);
  }

  protected toggleFavoriteStudio(scene: SceneDetails): void {
    if (!scene.studioId) {
      this.notifications.info('Studio information is unavailable');
      return;
    }

    if (this.favoritingStudio()) {
      return;
    }

    const nextFavorite = !scene.studioIsFavorite;

    this.favoritingStudio.set(true);
    this.discoverService
      .favoriteStudio(scene.studioId, nextFavorite)
      .pipe(
        finalize(() => {
          this.favoritingStudio.set(false);
        }),
      )
      .subscribe({
        next: (result) => {
          this.scene.update((current) =>
            current ? { ...current, studioIsFavorite: nextFavorite } : current,
          );

          if (nextFavorite && result.alreadyFavorited) {
            this.notifications.info('Studio already favorited');
            return;
          }

          this.notifications.success(nextFavorite ? 'Studio favorited' : 'Studio unfavorited');
        },
        error: () => {
          this.notifications.error(
            nextFavorite ? 'Failed to favorite studio' : 'Failed to unfavorite studio',
          );
        },
      });
  }

  protected performerFavoriteToggleBusy(performerId: string): boolean {
    return this.performerFavoriteInFlightById()[performerId] === true;
  }

  protected performerFavoriteToggleLabel(isFavorite: boolean): string {
    return isFavorite ? 'Unfavorite performer' : 'Favorite performer';
  }

  protected toggleScenePerformerFavorite(event: Event, performer: ScenePerformer): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.performerFavoriteToggleBusy(performer.id)) {
      return;
    }

    const nextFavorite = !performer.isFavorite;
    this.setPerformerFavoriteBusy(performer.id, true);
    this.discoverService
      .favoritePerformer(performer.id, nextFavorite)
      .pipe(
        finalize(() => {
          this.setPerformerFavoriteBusy(performer.id, false);
        }),
      )
      .subscribe({
        next: (result) => {
          this.scene.update((current) =>
            current
              ? {
                  ...current,
                  performers: current.performers.map((currentPerformer) =>
                    currentPerformer.id === performer.id
                      ? { ...currentPerformer, isFavorite: nextFavorite }
                      : currentPerformer,
                  ),
                }
              : current,
          );

          if (nextFavorite && result.alreadyFavorited) {
            this.notifications.info('Performer already favorited');
            return;
          }

          this.notifications.success(
            nextFavorite ? 'Performer favorited' : 'Performer unfavorited',
          );
        },
        error: () => {
          this.notifications.error(
            nextFavorite ? 'Failed to favorite performer' : 'Failed to unfavorite performer',
          );
        },
      });
  }

  protected openRequestPanel(scene: SceneDetails): void {
    if (!this.canRequestScene(scene)) {
      return;
    }

    this.previousFocusedElement = document.activeElement as HTMLElement | null;
    this.requestContext.set({
      id: scene.id,
      title: scene.title,
      imageUrl: scene.imageUrl,
    });
    this.requestModalOpen.set(true);
  }

  protected onRequestModalClosed(): void {
    this.requestModalOpen.set(false);

    setTimeout(() => {
      const focusTarget = this.requestTriggerButton?.nativeElement ?? this.previousFocusedElement;
      focusTarget?.focus();
      this.previousFocusedElement = null;
    }, 0);
  }

  protected onRequestSubmitted(stashId: string): void {
    this.loadScene(stashId);
  }

  protected currentRouteUrl(): string {
    return this.router.url;
  }

  private loadSceneByRoute(): void {
    const stashIdParam = this.route.snapshot.paramMap.get('stashId')?.trim();
    if (!stashIdParam) {
      this.error.set('Scene id is missing from the route.');
      this.loading.set(false);
      return;
    }

    this.loadScene(stashIdParam);
  }

  private loadScene(stashIdParam: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.descriptionExpanded.set(false);
    this.selectedStashCopyUrl.set(null);
    this.requestModalOpen.set(false);
    this.performerFavoriteInFlightById.set({});

    this.discoverService
      .getSceneDetails(stashIdParam)
      .pipe(
        finalize(() => {
          this.loading.set(false);
        }),
      )
      .subscribe({
        next: (scene) => {
          this.scene.set(scene);
          this.selectedStashCopyUrl.set(scene.stash?.copies[0]?.viewUrl ?? null);
          this.requestContext.set({
            id: scene.id,
            title: scene.title,
            imageUrl: scene.imageUrl,
          });
        },
        error: () => {
          this.error.set('Failed to load scene details from the API.');
        },
      });
  }

  private normalizeDescription(description: string): string {
    return description.replaceAll(/\s+/g, ' ').trim();
  }

  private whisparrLifecycleStep(scene: SceneDetails): SceneLifecycleStep {
    switch (scene.status.state) {
      case 'REQUESTED':
        return {
          system: 'Whisparr',
          title: 'Requested',
          detail: 'Whisparr knows about this scene, but acquisition has not started.',
          tone: 'active',
        };
      case 'DOWNLOADING':
        return {
          system: 'Whisparr',
          title: 'Downloading',
          detail: 'Whisparr is actively pulling the asset into your pipeline.',
          tone: 'active',
        };
      case 'IMPORT_PENDING':
        return {
          system: 'Whisparr',
          title: 'Ready for import',
          detail: 'Whisparr has finished acquisition and is waiting for Stash to pick it up.',
          tone: 'complete',
        };
      case 'AVAILABLE':
        return {
          system: 'Whisparr',
          title: 'Handled',
          detail: scene.whisparr?.exists
            ? 'Whisparr has a linked record for this scene.'
            : 'The request pipeline has already handed this scene off to your library.',
          tone: 'complete',
        };
      case 'FAILED':
        return {
          system: 'Whisparr',
          title: 'Failed',
          detail:
            'The last known acquisition attempt failed. Resolve or retry this download in Whisparr because Stasharr does not remediate failed Whisparr jobs.',
          tone: 'active',
        };
      case 'NOT_REQUESTED':
      default:
        return {
          system: 'Whisparr',
          title: 'Not requested',
          detail: 'No Whisparr request or tracked acquisition is linked yet.',
          tone: 'pending',
        };
    }
  }

  private stashLifecycleStep(scene: SceneDetails): SceneLifecycleStep {
    if (scene.status.state === 'AVAILABLE') {
      return {
        system: 'Stash',
        title: 'In library',
        detail: 'A linked local scene is available in Stash.',
        tone: 'complete',
      };
    }

    if (scene.status.state === 'IMPORT_PENDING') {
      return {
        system: 'Stash',
        title: 'Awaiting import',
        detail: 'Stash has not linked a local copy yet.',
        tone: 'active',
      };
    }

    return {
      system: 'Stash',
      title: 'Not in library',
      detail: 'No linked Stash scene is available yet.',
      tone: 'pending',
    };
  }

  private parseReturnTo(
    rawReturnTo: string | null,
    fallback: string,
  ): { path: string; queryParams: Params } {
    const trimmed = rawReturnTo?.trim();
    if (!trimmed) {
      return { path: fallback, queryParams: {} };
    }

    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
      return { path: fallback, queryParams: {} };
    }

    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) {
      return { path: fallback, queryParams: {} };
    }

    try {
      const parsed = this.router.parseUrl(trimmed);
      const primarySegments = parsed.root.children['primary']?.segments ?? [];
      const path = `/${primarySegments.map((segment) => segment.path).join('/')}`;
      const canonicalPath = path === '/discover' ? '/scenes' : path;
      return {
        path: canonicalPath === '/' ? fallback : canonicalPath,
        queryParams: parsed.queryParams,
      };
    } catch {
      return { path: fallback, queryParams: {} };
    }
  }

  private backLinkText(returnTo: string, fallbackLabel: string): string {
    if (returnTo.startsWith('/home')) {
      return 'Back to Home';
    }
    if (returnTo.startsWith('/scenes')) {
      return 'Back to Scenes';
    }
    if (returnTo.startsWith('/acquisition')) {
      return 'Back to Acquisition';
    }
    if (returnTo.startsWith('/library')) {
      return 'Back to Library';
    }
    if (returnTo.startsWith('/performers')) {
      return 'Back to Performers';
    }
    if (returnTo.startsWith('/performer/')) {
      return 'Back to Performer';
    }
    if (returnTo.startsWith('/studios')) {
      return 'Back to Studios';
    }
    if (returnTo.startsWith('/studio/')) {
      return 'Back to Studio';
    }
    if (returnTo.startsWith('/scene/')) {
      return 'Back to Scene';
    }

    return fallbackLabel;
  }

  private setPerformerFavoriteBusy(performerId: string, busy: boolean): void {
    this.performerFavoriteInFlightById.update((current) => {
      if (busy) {
        return {
          ...current,
          [performerId]: true,
        };
      }

      const next = { ...current };
      delete next[performerId];
      return next;
    });
  }
}
