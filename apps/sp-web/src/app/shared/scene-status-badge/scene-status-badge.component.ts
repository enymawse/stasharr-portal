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
          @switch (status().state) {
            @case ('AVAILABLE') {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.3 7.2 10.5 17l-4.8-4.8 1.6-1.6 3.2 3.2 8.2-8.2z" />
              </svg>
            }
            @case ('REQUESTED') {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5a7 7 0 1 1-7 7h2a5 5 0 1 0 5-5z" />
                <path d="M11 8h2v5h-2z" />
                <path d="M12 12h4v2h-4z" />
              </svg>
            }
            @case ('PROCESSING') {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4a8 8 0 0 1 8 8h-2a6 6 0 1 0-6 6v2a8 8 0 0 1 0-16z" />
              </svg>
            }
            @case ('FAILED') {
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m7.4 6 4.6 4.6L16.6 6 18 7.4 13.4 12l4.6 4.6-1.4 1.4-4.6-4.6-4.6 4.6L6 16.6l4.6-4.6L6 7.4z" />
              </svg>
            }
          }
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
    () => this.status().state !== 'UNREQUESTED',
  );

  protected readonly badgeLabel = computed(() => {
    switch (this.status().state) {
      case 'REQUESTED':
        return 'Requested';
      case 'PROCESSING':
        return 'Processing';
      case 'AVAILABLE':
        return 'Available';
      case 'FAILED':
        return 'Failed';
      case 'UNREQUESTED':
      default:
        return 'Unrequested';
    }
  });

  protected readonly badgeClass = computed(() => {
    switch (this.status().state) {
      case 'REQUESTED':
        return 'badge requested';
      case 'PROCESSING':
        return 'badge processing';
      case 'AVAILABLE':
        return 'badge available';
      case 'FAILED':
        return 'badge failed';
      case 'UNREQUESTED':
      default:
        return 'badge unrequested';
    }
  });

  protected readonly iconClass = computed(() => {
    switch (this.status().state) {
      case 'REQUESTED':
        return 'icon requested';
      case 'PROCESSING':
        return 'icon processing';
      case 'AVAILABLE':
        return 'icon available';
      case 'FAILED':
        return 'icon failed';
      case 'UNREQUESTED':
      default:
        return 'icon unrequested';
    }
  });
}
