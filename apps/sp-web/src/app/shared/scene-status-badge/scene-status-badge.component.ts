import { Component, computed, input } from '@angular/core';
import { SceneStatus } from '../../core/api/discover.types';
import {
  sceneStatusBadgeLabel,
  sceneStatusBadgeModifier,
  sceneStatusIconClass,
  sceneStatusIconVisible,
} from './scene-status-badge.model';

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

  protected readonly iconVisible = computed(() => sceneStatusIconVisible(this.status()));

  protected readonly badgeLabel = computed(() => sceneStatusBadgeLabel(this.status()));

  protected readonly badgeClass = computed(
    () => `badge ${sceneStatusBadgeModifier(this.status())}`,
  );

  protected readonly iconClass = computed(() => `icon ${sceneStatusBadgeModifier(this.status())}`);

  protected readonly statusIconClass = computed(() => sceneStatusIconClass(this.status()));
}
