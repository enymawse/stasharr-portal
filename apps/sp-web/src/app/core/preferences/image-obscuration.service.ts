import { DOCUMENT } from '@angular/common';
import { Injectable, Signal, computed, inject, signal } from '@angular/core';

export type ImageObscurationMode = 'clear' | 'obscured';

@Injectable({
  providedIn: 'root',
})
export class ImageObscurationService {
  private static readonly STORAGE_KEY = 'sp-images';

  private readonly document = inject(DOCUMENT);
  private readonly modeState = signal<ImageObscurationMode>('clear');

  readonly mode: Signal<ImageObscurationMode> = this.modeState.asReadonly();
  readonly isObscured = computed(() => this.modeState() === 'obscured');

  constructor() {
    this.initializeMode();
  }

  toggle(): void {
    this.setMode(this.modeState() === 'obscured' ? 'clear' : 'obscured');
  }

  setMode(mode: ImageObscurationMode): void {
    this.modeState.set(mode);
    this.persistMode(mode);
    this.applyMode(mode);
  }

  private initializeMode(): void {
    const mode = this.readStoredMode();
    this.modeState.set(mode);
    this.applyMode(mode);
  }

  private applyMode(mode: ImageObscurationMode): void {
    const root = this.document.documentElement;

    if (mode === 'obscured') {
      root.setAttribute('data-images', 'obscured');
    } else {
      root.removeAttribute('data-images');
    }
  }

  private readStoredMode(): ImageObscurationMode {
    if (typeof window === 'undefined') {
      return 'clear';
    }

    return window.localStorage.getItem(ImageObscurationService.STORAGE_KEY) ===
      'obscured'
      ? 'obscured'
      : 'clear';
  }

  private persistMode(mode: ImageObscurationMode): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(ImageObscurationService.STORAGE_KEY, mode);
  }
}
