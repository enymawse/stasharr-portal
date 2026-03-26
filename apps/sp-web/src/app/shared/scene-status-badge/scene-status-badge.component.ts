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

  protected readonly iconVisible = computed(() => this.status().state !== 'NOT_REQUESTED');

  protected readonly badgeLabel = computed(() => {
    switch (this.status().state) {
      case 'REQUESTED':
        return 'Requested';
      case 'DOWNLOADING':
        return 'Downloading';
      case 'IMPORT_PENDING':
        return 'Awaiting Import';
      case 'AVAILABLE':
        return 'In Library';
      case 'NOT_REQUESTED':
      default:
        return 'Not Requested';
    }
  });

  protected readonly badgeClass = computed(() => {
    switch (this.status().state) {
      case 'REQUESTED':
        return 'badge requested';
      case 'DOWNLOADING':
        return 'badge downloading';
      case 'IMPORT_PENDING':
        return 'badge import-pending';
      case 'AVAILABLE':
        return 'badge available';
      case 'NOT_REQUESTED':
      default:
        return 'badge not-requested';
    }
  });

  protected readonly iconClass = computed(() => {
    switch (this.status().state) {
      case 'REQUESTED':
        return 'icon requested';
      case 'DOWNLOADING':
        return 'icon downloading';
      case 'IMPORT_PENDING':
        return 'icon import-pending';
      case 'AVAILABLE':
        return 'icon available';
      case 'NOT_REQUESTED':
      default:
        return 'icon not-requested';
    }
  });

  protected readonly statusIconClass = computed(() => {
    switch (this.status().state) {
      case 'REQUESTED':
        return 'pi pi-bookmark';
      case 'DOWNLOADING':
        return 'pi pi-spinner pi-spin';
      case 'IMPORT_PENDING':
        return 'pi pi-upload';
      case 'AVAILABLE':
        return 'pi pi-check-circle';
      case 'NOT_REQUESTED':
      default:
        return 'pi pi-circle';
    }
  });
}
