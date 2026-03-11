import { Component, computed, input } from '@angular/core';
import { SceneStatus } from '../../core/api/discover.types';

@Component({
  selector: 'app-scene-status-badge',
  template: `
    <span class="badge" [class]="badgeClass()">{{ badgeLabel() }}</span>
  `,
  styleUrl: './scene-status-badge.component.scss',
})
export class SceneStatusBadgeComponent {
  readonly status = input.required<SceneStatus>();

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
}
