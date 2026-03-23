import { Component, computed, input } from '@angular/core';
import { SceneStatus } from '../../core/api/discover.types';

@Component({
  selector: 'app-scene-status-badge',
  template: `
    @if (mode() === 'icon') {
      @if (iconVisible()) {
        <span
          class="icon"
          [class]="iconClass()"
          role="img"
          [attr.aria-label]="badgeLabel()"
          [attr.title]="badgeLabel()"
        >
          <i [class]="statusIconClass()" aria-hidden="true"></i>
        </span>
      }
    } @else {
      <span class="badge" [class]="badgeClass()">{{ badgeLabel() }}</span>
    }
  `,
  styleUrl: './scene-status-badge.component.scss',
})
export class SceneStatusBadgeComponent {
  readonly status = input.required<SceneStatus>();
  readonly mode = input<'badge' | 'icon'>('badge');

  protected readonly iconVisible = computed(
    () => this.status().state !== 'NOT_REQUESTED',
  );

  protected readonly badgeLabel = computed(() => {
    switch (this.status().state) {
      case 'DOWNLOADING':
        return 'Downloading';
      case 'AVAILABLE':
        return 'Available';
      case 'MISSING':
        return 'Missing';
      case 'NOT_REQUESTED':
      default:
        return 'Not Requested';
    }
  });

  protected readonly badgeClass = computed(() => {
    switch (this.status().state) {
      case 'DOWNLOADING':
        return 'badge downloading';
      case 'AVAILABLE':
        return 'badge available';
      case 'MISSING':
        return 'badge missing';
      case 'NOT_REQUESTED':
      default:
        return 'badge not-requested';
    }
  });

  protected readonly iconClass = computed(() => {
    switch (this.status().state) {
      case 'DOWNLOADING':
        return 'icon downloading';
      case 'AVAILABLE':
        return 'icon available';
      case 'MISSING':
        return 'icon missing';
      case 'NOT_REQUESTED':
      default:
        return 'icon not-requested';
    }
  });

  protected readonly statusIconClass = computed(() => {
    switch (this.status().state) {
      case 'DOWNLOADING':
        return 'pi pi-spinner pi-spin';
      case 'AVAILABLE':
        return 'pi pi-check-circle';
      case 'MISSING':
        return 'pi pi-times-circle';
      case 'NOT_REQUESTED':
      default:
        return 'pi pi-circle';
    }
  });
}
