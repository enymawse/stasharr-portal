import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { Subscription } from 'rxjs';
import { DiscoverService } from '../../core/api/discover.service';
import { SceneRequestOptions } from '../../core/api/discover.types';

@Component({
  selector: 'app-scene-request-modal',
  imports: [ReactiveFormsModule],
  templateUrl: './scene-request-modal.component.html',
  styleUrl: './scene-request-modal.component.scss',
})
export class SceneRequestModalComponent implements OnChanges, OnDestroy {
  private readonly discoverService = inject(DiscoverService);
  private readonly document = inject(DOCUMENT);
  private restoreBodyOverflowValue: string | null = null;
  private loadedForSceneId: string | null = null;
  private loadingSceneId: string | null = null;
  private optionsLoadSub: Subscription | null = null;

  @Input() open = false;
  @Input() sceneId: string | null = null;
  @Input() sceneTitle: string | null = null;
  @Input() sceneImageUrl: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<string>();

  @ViewChild('requestCloseButton')
  set requestCloseButton(elementRef: ElementRef<HTMLButtonElement> | undefined) {
    const closeButton = elementRef?.nativeElement ?? null;
    if (!closeButton || !this.open) {
      return;
    }

    setTimeout(() => {
      closeButton.focus();
    }, 0);
  }

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

  ngOnChanges(): void {
    if (!this.open) {
      this.cancelOptionsLoad();
      this.requestOptionsLoading.set(false);
      this.requestSubmitLoading.set(false);
      this.unlockBodyScroll();
      return;
    }

    this.lockBodyScroll();
    this.requestSubmitError.set(null);

    const nextSceneId = this.sceneId?.trim() ?? '';
    if (!nextSceneId) {
      this.requestOptionsError.set('Scene id is required to request this scene.');
      return;
    }

    if (this.loadedForSceneId === nextSceneId && this.requestOptions()) {
      return;
    }

    this.loadOptionsForScene(nextSceneId);
  }

  ngOnDestroy(): void {
    this.cancelOptionsLoad();
    this.unlockBodyScroll();
  }

  protected closeModal(): void {
    if (this.requestSubmitLoading()) {
      return;
    }

    this.closed.emit();
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    this.closeModal();
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

  protected submitRequest(): void {
    if (this.requestSubmitLoading()) {
      return;
    }

    const currentSceneId = this.sceneId?.trim() ?? '';
    if (!currentSceneId) {
      this.requestSubmitError.set('Scene id is required to submit a request.');
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
      .submitSceneRequest(currentSceneId, {
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
          this.submitted.emit(currentSceneId);
          this.closed.emit();
        },
        error: () => {
          this.requestSubmitError.set('Failed to submit request to the API.');
        },
      });
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected onEscapeKey(event: Event): void {
    if (!this.open) {
      return;
    }

    event.preventDefault();
    this.closeModal();
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

  private loadOptionsForScene(sceneId: string): void {
    if (this.requestOptionsLoading() && this.loadingSceneId === sceneId) {
      return;
    }

    this.cancelOptionsLoad();
    this.loadingSceneId = sceneId;
    this.requestOptions.set(null);
    this.requestOptionsError.set(null);
    this.requestOptionsLoading.set(true);

    const subscription = this.discoverService
      .getSceneRequestOptions(sceneId)
      .pipe(
        finalize(() => {
          this.requestOptionsLoading.set(false);
          this.loadingSceneId = null;
          if (this.optionsLoadSub === subscription) {
            this.optionsLoadSub = null;
          }
        }),
      )
      .subscribe({
        next: (options) => {
          this.loadedForSceneId = sceneId;
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

    this.optionsLoadSub = subscription;
  }

  private cancelOptionsLoad(): void {
    this.optionsLoadSub?.unsubscribe();
    this.optionsLoadSub = null;
    this.loadingSceneId = null;
  }
}
