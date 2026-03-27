import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { Subscription } from 'rxjs';
import { ButtonDirective } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Message } from 'primeng/message';
import { MultiSelect } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Select } from 'primeng/select';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { DiscoverService } from '../../core/api/discover.service';
import { AppNotificationsService } from '../../core/notifications/app-notifications.service';
import { SceneRequestOptions } from '../../core/api/discover.types';

type StringSelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
};

type NumberSelectOption = {
  label: string;
  value: number;
  disabled?: boolean;
};

@Component({
  selector: 'app-scene-request-modal',
  imports: [
    ReactiveFormsModule,
    Dialog,
    ButtonDirective,
    Message,
    ProgressSpinner,
    Select,
    ToggleSwitch,
    MultiSelect,
  ],
  templateUrl: './scene-request-modal.component.html',
  styleUrl: './scene-request-modal.component.scss',
})
export class SceneRequestModalComponent implements OnChanges, OnDestroy {
  private readonly discoverService = inject(DiscoverService);
  private readonly notifications = inject(AppNotificationsService);
  private loadedForSceneId: string | null = null;
  private loadingSceneId: string | null = null;
  private optionsLoadSub: Subscription | null = null;

  @Input() open = false;
  @Input() sceneId: string | null = null;
  @Input() sceneTitle: string | null = null;
  @Input() sceneImageUrl: string | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() submitted = new EventEmitter<string>();

  protected readonly requestOptionsLoading = signal(false);
  protected readonly requestOptionsError = signal<string | null>(null);
  protected readonly requestOptions = signal<SceneRequestOptions | null>(null);
  protected readonly requestSubmitLoading = signal(false);
  protected readonly requestSubmitError = signal<string | null>(null);

  protected readonly dialogBreakpoints = {
    '960px': '94vw',
    '640px': '98vw',
  };

  protected readonly rootFolderOptions = computed<StringSelectOption[]>(() => {
    const options = this.requestOptions();
    if (!options) {
      return [];
    }

    return options.rootFolders.map((folder) => ({
      label: folder.accessible ? folder.path : `${folder.path} (Unavailable)`,
      value: folder.path,
      disabled: !folder.accessible,
    }));
  });

  protected readonly qualityProfileOptions = computed<NumberSelectOption[]>(() => {
    const options = this.requestOptions();
    if (!options) {
      return [];
    }

    return options.qualityProfiles.map((profile) => ({
      label: profile.name,
      value: profile.id,
    }));
  });

  protected readonly tagOptions = computed<NumberSelectOption[]>(() => {
    const options = this.requestOptions();
    if (!options) {
      return [];
    }

    return options.tags.map((tag) => ({
      label: tag.label,
      value: tag.id,
    }));
  });

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
      return;
    }

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
  }

  protected closeModal(): void {
    if (this.requestSubmitLoading()) {
      return;
    }

    this.closed.emit();
  }

  protected onDialogVisibleChange(visible: boolean): void {
    if (visible || !this.open) {
      return;
    }

    this.closeModal();
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
          this.notifications.success(
            'Scene request submitted to Whisparr',
            'Track progress on Acquisition.',
          );
          this.submitted.emit(currentSceneId);
          this.closed.emit();
        },
        error: () => {
          this.requestSubmitError.set('Failed to submit request to the API.');
        },
      });
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
