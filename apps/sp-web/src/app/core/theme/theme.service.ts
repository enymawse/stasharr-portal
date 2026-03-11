import { DOCUMENT } from '@angular/common';
import { Injectable, Signal, inject, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private static readonly STORAGE_KEY = 'sp-theme';

  private readonly document = inject(DOCUMENT);
  private readonly themeState = signal<ThemeMode>('light');

  readonly theme: Signal<ThemeMode> = this.themeState.asReadonly();

  constructor() {
    this.initializeTheme();
  }

  toggleTheme(): void {
    this.setTheme(this.themeState() === 'dark' ? 'light' : 'dark');
  }

  setTheme(theme: ThemeMode): void {
    this.themeState.set(theme);
    this.persistTheme(theme);
    this.applyTheme(theme);
  }

  private initializeTheme(): void {
    const stored = this.readStoredTheme();
    const initialTheme = stored ?? this.detectSystemTheme();
    this.themeState.set(initialTheme);
    this.applyTheme(initialTheme);
  }

  private detectSystemTheme(): ThemeMode {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'light';
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  private applyTheme(theme: ThemeMode): void {
    const root = this.document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  }

  private readStoredTheme(): ThemeMode | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const value = window.localStorage.getItem(ThemeService.STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  }

  private persistTheme(theme: ThemeMode): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(ThemeService.STORAGE_KEY, theme);
  }
}
