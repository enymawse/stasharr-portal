import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { SceneDetails, SceneRequestOptions } from '../../core/api/discover.types';
import { SceneStatusBadgeComponent } from '../../shared/scene-status-badge/scene-status-badge.component';

@Component({
  selector: 'app-scene-page',
  imports: [RouterLink, SceneStatusBadgeComponent, ReactiveFormsModule],
  templateUrl: './scene-page.component.html',
  styleUrl: './scene-page.component.scss',
})
export class ScenePageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly discoverService = inject(DiscoverService);
  private readonly document = inject(DOCUMENT);
  private restoreBodyOverflowValue: string | null = null;
  private previousFocusedElement: HTMLElement | null = null;

  @ViewChild('requestTriggerButton')
  private requestTriggerButton?: ElementRef<HTMLButtonElement>;

  @ViewChild('requestCloseButton')
  set requestCloseButton(elementRef: ElementRef<HTMLButtonElement> | undefined) {
    const closeButton = elementRef?.nativeElement ?? null;
    if (!closeButton || !this.requestPanelOpen()) {
      return;
    }

    setTimeout(() => {
      closeButton.focus();
    }, 0);
  }

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly scene = signal<SceneDetails | null>(null);
  protected readonly descriptionExpanded = signal(false);
  protected readonly selectedStashCopyUrl = signal<string | null>(null);
  protected readonly requestPanelOpen = signal(false);
  protected readonly requestOptionsLoading = signal(false);
  protected readonly requestOptionsError = signal<string | null>(null);
  protected readonly requestOptions = signal<SceneRequestOptions | null>(null);
  protected readonly requestSubmitLoading = signal(false);
  protected readonly requestSubmitError = signal<string | null>(null);

  protected readonly requestForm = new FormGroup({
    monitored: new FormControl(true, { nonNullable: true }),
    rootFolderPath: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    searchForMovie: new FormControl(true, { nonNullable: true }),
    qualityProfileId: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(1)],
    }),
    tags: new FormControl<number[]>([], { nonNullable: true }),
  });

  ngOnInit(): void {
    this.loadSceneByRoute();
  }

  ngOnDestroy(): void {
    this.unlockBodyScroll();
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

  protected onStashCopySelected(viewUrl: string): void {
    this.selectedStashCopyUrl.set(viewUrl);
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
    if (!this.canRequestScene(scene) || this.requestOptionsLoading()) {
      return;
    }

    this.previousFocusedElement = this.document.activeElement as HTMLElement | null;
    this.requestPanelOpen.set(true);
    this.requestSubmitError.set(null);
    this.lockBodyScroll();

    if (this.requestOptions()) {
      return;
    }

    this.requestOptionsLoading.set(true);
    this.requestOptionsError.set(null);

    this.discoverService
      .getSceneRequestOptions(scene.id)
      .pipe(
        finalize(() => {
          this.requestOptionsLoading.set(false);
        }),
      )
      .subscribe({
        next: (options) => {
          this.requestOptions.set(options);
          this.requestForm.patchValue({
            monitored: options.defaults.monitored,
            searchForMovie: options.defaults.searchForMovie,
            rootFolderPath:
              options.rootFolders.find((folder) => folder.accessible)?.path ??
              options.rootFolders[0]?.path ??
              '',
            qualityProfileId: options.qualityProfiles[0]?.id ?? null,
            tags: [],
          });
        },
        error: () => {
          this.requestOptionsError.set('Failed to load request options from the API.');
        },
      });
  }

  protected closeRequestPanel(): void {
    if (this.requestSubmitLoading()) {
      return;
    }

    this.requestPanelOpen.set(false);
    this.requestSubmitLoading.set(false);
    this.requestSubmitError.set(null);
    this.unlockBodyScroll();

    setTimeout(() => {
      const focusTarget =
        this.requestTriggerButton?.nativeElement ?? this.previousFocusedElement;
      focusTarget?.focus();
      this.previousFocusedElement = null;
    }, 0);
  }

  protected toggleTagSelection(tagId: number, checked: boolean): void {
    const current = this.requestForm.controls.tags.value;
    if (checked) {
      if (!current.includes(tagId)) {
        this.requestForm.controls.tags.setValue([...current, tagId]);
      }
      return;
    }

    this.requestForm.controls.tags.setValue(current.filter((id) => id !== tagId));
  }

  protected tagChecked(tagId: number): boolean {
    return this.requestForm.controls.tags.value.includes(tagId);
  }

  protected submitSceneRequest(scene: SceneDetails): void {
    if (this.requestSubmitLoading()) {
      return;
    }

    if (this.requestForm.invalid) {
      this.requestForm.markAllAsTouched();
      return;
    }

    const qualityProfileId = this.requestForm.controls.qualityProfileId.value;
    if (!qualityProfileId) {
      this.requestForm.controls.qualityProfileId.markAsTouched();
      return;
    }

    this.requestSubmitLoading.set(true);
    this.requestSubmitError.set(null);

    this.discoverService
      .submitSceneRequest(scene.id, {
        monitored: this.requestForm.controls.monitored.value,
        rootFolderPath: this.requestForm.controls.rootFolderPath.value,
        searchForMovie: this.requestForm.controls.searchForMovie.value,
        qualityProfileId,
        tags: this.requestForm.controls.tags.value,
      })
      .pipe(
        finalize(() => {
          this.requestSubmitLoading.set(false);
        }),
      )
      .subscribe({
        next: () => {
          this.closeRequestPanel();
          this.requestOptions.set(null);
          this.loadScene(scene.id);
        },
        error: () => {
          this.requestSubmitError.set('Failed to submit request to the API.');
        },
      });
  }

  protected onRequestModalBackdropClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    this.closeRequestPanel();
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected onEscapeKey(event: Event): void {
    if (!this.requestPanelOpen()) {
      return;
    }

    event.preventDefault();
    this.closeRequestPanel();
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
    this.requestPanelOpen.set(false);
    this.requestOptionsLoading.set(false);
    this.requestOptionsError.set(null);
    this.requestSubmitLoading.set(false);
    this.requestSubmitError.set(null);
    this.unlockBodyScroll();

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
        },
        error: () => {
          this.error.set('Failed to load scene details from the API.');
        },
      });
  }

  private normalizeDescription(description: string): string {
    return description.replaceAll(/\s+/g, ' ').trim();
  }

  private lockBodyScroll(): void {
    if (this.restoreBodyOverflowValue !== null) {
      return;
    }

    this.restoreBodyOverflowValue = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';
  }

  private unlockBodyScroll(): void {
    if (this.restoreBodyOverflowValue === null) {
      return;
    }

    this.document.body.style.overflow = this.restoreBodyOverflowValue;
    this.restoreBodyOverflowValue = null;
  }
}
