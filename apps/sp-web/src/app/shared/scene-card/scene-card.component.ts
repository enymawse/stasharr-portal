import { Component, EventEmitter, Input, Output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';
import { SceneRequestContext, SceneStatus } from '../../core/api/discover.types';
import {
  SceneCardMediaFooterDirective,
  SceneCardShellComponent,
  SceneCardShellItem,
  SceneCardShellLink,
  SceneCardTopRightDirective,
} from './scene-card-shell.component';
import { SceneStatusBadgeComponent } from '../scene-status-badge/scene-status-badge.component';

export interface SceneCardItem extends SceneCardShellItem {
  id: string;
  releaseDate: string | null;
  status?: SceneStatus | null;
}

export type SceneCardVariant = 'default' | 'rail';
export type SceneCardPrimaryLinkMode = 'scene' | 'external';
export type SceneCardStudioBadgeRoute = 'none' | 'scenes' | 'library';

export interface SceneCardBadge {
  label: string;
}

@Component({
  selector: 'app-scene-card',
  imports: [
    RouterLink,
    SceneCardShellComponent,
    SceneCardTopRightDirective,
    SceneCardMediaFooterDirective,
    SceneStatusBadgeComponent,
  ],
  templateUrl: './scene-card.component.html',
  styleUrl: './scene-card.component.scss',
  host: {
    '[class.scene-card-variant-rail]': "variant === 'rail'",
    '[class.scene-card-variant-default]': "variant !== 'rail'",
  },
})
export class SceneCardComponent {
  @Input({ required: true }) item!: SceneCardItem;
  @Input() requestable = false;
  @Input() variant: SceneCardVariant = 'default';
  @Input() primaryLinkMode: SceneCardPrimaryLinkMode = 'scene';
  @Input() sceneRouteId: string | null = null;
  @Input() sceneQueryParams: Params | null = null;
  @Input() externalHref: string | null = null;
  @Input() studioBadgeRoute: SceneCardStudioBadgeRoute = 'none';
  @Input() topBadges: readonly SceneCardBadge[] = [];
  @Input() footerLink: SceneCardShellLink | null = null;
  @Input() footerLinkLabel: string | null = null;
  @Input() footerBadgeLabel: string | null = null;

  @Output() request = new EventEmitter<SceneRequestContext>();

  protected shellVariant(): 'default' | 'rail' {
    return this.variant === 'rail' ? 'rail' : 'default';
  }

  protected statusIcon(): SceneStatus | null {
    const status = this.item.status;
    return status && status.state !== 'NOT_REQUESTED' ? status : null;
  }

  protected primaryLink(): SceneCardShellLink {
    if (this.primaryLinkMode === 'external') {
      return {
        kind: 'external',
        href: this.externalHref ?? '',
        ariaLabel: this.item.title,
      };
    }

    return {
      kind: 'router',
      commands: ['/scene', this.sceneRouteIdValue()],
      queryParams: this.sceneQueryParams,
      ariaLabel: this.item.title,
    };
  }

  protected studioBadgeLink(): SceneCardShellLink | null {
    if (
      this.studioBadgeRoute === 'none' ||
      !this.item.studioId ||
      !this.item.studio
    ) {
      return null;
    }

    return {
      kind: 'router',
      commands: [this.studioBadgeRoute === 'library' ? '/library' : '/scenes'],
      queryParams: {
        studios: this.item.studioId,
        studioNames: this.item.studio,
      },
      ariaLabel: `Filter ${this.studioBadgeRoute} by studio ${this.item.studio}`,
    };
  }

  protected footerLinkText(): string | null {
    if (!this.footerLink) {
      return null;
    }

    const label = this.footerLinkLabel?.trim() ?? '';
    return label.length > 0 ? label : null;
  }

  protected footerBadgeText(): string | null {
    const label = this.footerBadgeLabel?.trim() ?? '';
    return label.length > 0 ? label : null;
  }

  protected footerLinkIsExternal(): boolean {
    return this.footerLink?.kind === 'external';
  }

  protected footerLinkRouterCommands(): string | readonly unknown[] | null {
    return this.footerLink?.kind === 'router' ? this.footerLink.commands : null;
  }

  protected footerLinkQueryParams(): Params | null {
    return this.footerLink?.kind === 'router' ? (this.footerLink.queryParams ?? null) : null;
  }

  protected footerExternalHref(): string | null {
    if (this.footerLink?.kind !== 'external') {
      return null;
    }

    const href = this.footerLink.href.trim();
    return href.length > 0 ? href : null;
  }

  protected footerStatus(): SceneStatus | null {
    if (this.requestable || this.footerLinkText() || this.footerBadgeText()) {
      return null;
    }

    return this.item.status ?? null;
  }

  protected requestScene(event: MouseEvent): void {
    event.stopPropagation();
    this.request.emit({
      id: this.item.id,
      title: this.item.title,
      imageUrl: this.item.imageUrl,
    });
  }

  private sceneRouteIdValue(): string {
    const sceneRouteId = this.sceneRouteId?.trim() ?? '';
    return sceneRouteId.length > 0 ? sceneRouteId : this.item.id;
  }
}
