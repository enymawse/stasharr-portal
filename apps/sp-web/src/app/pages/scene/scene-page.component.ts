import { Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Message } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { DiscoverService } from '../../core/api/discover.service';
import { SceneDetails, SceneRequestContext } from '../../core/api/discover.types';
import { SceneRequestModalComponent } from '../../shared/scene-request-modal/scene-request-modal.component';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

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
export class ScenePageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly discoverService = inject(DiscoverService);
  private previousFocusedElement: HTMLElement | null = null;

  @ViewChild('requestTriggerButton')
  private requestTriggerButton?: ElementRef<HTMLButtonElement>;

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly scene = signal<SceneDetails | null>(null);
  protected readonly descriptionExpanded = signal(false);
  protected readonly selectedStashCopyUrl = signal<string | null>(null);
  protected readonly requestModalOpen = signal(false);
  protected readonly requestContext = signal<SceneRequestContext | null>(null);
  protected readonly backLinkPath = signal('/discover');
  protected readonly backLinkQueryParams = signal<Params>({});
  protected readonly backLinkLabel = signal('Back to Discover');

  ngOnInit(): void {
    const resolvedBackLink = this.parseReturnTo(
      this.route.snapshot.queryParamMap.get('returnTo'),
      '/discover',
    );
    this.backLinkPath.set(resolvedBackLink.path);
    this.backLinkQueryParams.set(resolvedBackLink.queryParams);
    this.backLinkLabel.set(this.backLinkText(resolvedBackLink.path, 'Back to Discover'));
    this.loadSceneByRoute();
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

    return (
      scene.stash?.copies.find((copy) => copy.viewUrl === selected)?.label ??
      'View in Stash'
    );
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

  protected canRequestScene(scene: SceneDetails): boolean {
    return scene.status.state === 'NOT_REQUESTED';
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
      const focusTarget =
        this.requestTriggerButton?.nativeElement ?? this.previousFocusedElement;
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
      return {
        path: path === '/' ? fallback : path,
        queryParams: parsed.queryParams,
      };
    } catch {
      return { path: fallback, queryParams: {} };
    }
  }

  private backLinkText(returnTo: string, fallbackLabel: string): string {
    if (returnTo.startsWith('/discover')) {
      return 'Back to Discover';
    }
    if (returnTo.startsWith('/scenes')) {
      return 'Back to Scenes';
    }
    if (returnTo.startsWith('/requests')) {
      return 'Back to Requests';
    }
    if (returnTo.startsWith('/performers')) {
      return 'Back to Performers';
    }
    if (returnTo.startsWith('/performer/')) {
      return 'Back to Performer';
    }
    if (returnTo.startsWith('/scene/')) {
      return 'Back to Scene';
    }

    return fallbackLabel;
  }
}
