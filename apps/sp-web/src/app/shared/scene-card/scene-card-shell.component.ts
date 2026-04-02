import { Component, ContentChild, Directive, Input } from '@angular/core';
import { Params, RouterLink } from '@angular/router';

export interface SceneCardShellItem {
  title: string;
  imageUrl: string | null;
  cardImageUrl: string | null;
  studioId: string | null;
  studio: string | null;
  studioImageUrl: string | null;
}

export type SceneCardShellVariant = 'default' | 'rail';

export type SceneCardShellLink =
  | {
      kind: 'router';
      commands: string | readonly unknown[];
      queryParams?: Params | null;
      ariaLabel?: string | null;
    }
  | {
      kind: 'external';
      href: string;
      ariaLabel?: string | null;
    };

@Directive({
  selector: '[sceneCardTopRight]',
  standalone: true,
})
export class SceneCardTopRightDirective {}

@Directive({
  selector: '[sceneCardMediaFooter]',
  standalone: true,
})
export class SceneCardMediaFooterDirective {}

@Directive({
  selector: '[sceneCardBody]',
  standalone: true,
})
export class SceneCardBodyDirective {}

@Directive({
  selector: '[sceneCardPlaceholder]',
  standalone: true,
})
export class SceneCardPlaceholderDirective {}

@Component({
  selector: 'app-scene-card-shell',
  imports: [RouterLink],
  templateUrl: './scene-card-shell.component.html',
  styleUrl: './scene-card-shell.component.scss',
  host: {
    '[class.scene-card-shell-variant-rail]': "variant === 'rail'",
    '[class.scene-card-shell-variant-default]': "variant === 'default'",
  },
})
export class SceneCardShellComponent {
  @Input({ required: true }) item!: SceneCardShellItem;
  @Input() variant: SceneCardShellVariant = 'default';
  @Input() primaryLink: SceneCardShellLink | null = null;
  @Input() studioBadgeLink: SceneCardShellLink | null = null;

  @ContentChild(SceneCardTopRightDirective)
  private topRightSlot?: SceneCardTopRightDirective;

  @ContentChild(SceneCardMediaFooterDirective)
  private mediaFooterSlot?: SceneCardMediaFooterDirective;

  @ContentChild(SceneCardBodyDirective)
  private bodySlot?: SceneCardBodyDirective;

  protected thumbnailUrl(): string | null {
    return this.item.cardImageUrl ?? this.item.imageUrl;
  }

  protected hasStudioBadge(): boolean {
    return Boolean(this.item.studioImageUrl || this.item.studio);
  }

  protected hasTopRightSlot(): boolean {
    return Boolean(this.topRightSlot);
  }

  protected hasMediaTop(): boolean {
    return this.hasStudioBadge() || this.hasTopRightSlot();
  }

  protected hasMediaFooter(): boolean {
    return Boolean(this.mediaFooterSlot);
  }

  protected hasBody(): boolean {
    return Boolean(this.bodySlot);
  }

  protected primaryLinkIsExternal(): boolean {
    return this.primaryLink?.kind === 'external';
  }

  protected primaryRouterCommands(): string | readonly unknown[] | null {
    return this.primaryLink?.kind === 'router' ? this.primaryLink.commands : null;
  }

  protected primaryQueryParams(): Params | null {
    return this.primaryLink?.kind === 'router' ? (this.primaryLink.queryParams ?? null) : null;
  }

  protected primaryExternalHref(): string | null {
    if (this.primaryLink?.kind !== 'external') {
      return null;
    }

    const href = this.primaryLink.href.trim();
    return href.length > 0 ? href : null;
  }

  protected primaryLinkLabel(): string {
    const ariaLabel = this.primaryLink?.ariaLabel?.trim() ?? '';
    return ariaLabel.length > 0 ? ariaLabel : this.item.title;
  }

  protected studioBadgeLabel(): string {
    return this.item.studio ?? 'Studio';
  }

  protected studioBadgeLinkIsExternal(): boolean {
    return this.studioBadgeLink?.kind === 'external';
  }

  protected studioBadgeRouterCommands(): string | readonly unknown[] | null {
    return this.studioBadgeLink?.kind === 'router' ? this.studioBadgeLink.commands : null;
  }

  protected studioBadgeQueryParams(): Params | null {
    return this.studioBadgeLink?.kind === 'router'
      ? (this.studioBadgeLink.queryParams ?? null)
      : null;
  }

  protected studioBadgeExternalHref(): string | null {
    if (this.studioBadgeLink?.kind !== 'external') {
      return null;
    }

    const href = this.studioBadgeLink.href.trim();
    return href.length > 0 ? href : null;
  }

  protected studioBadgeAriaLabel(): string {
    const ariaLabel = this.studioBadgeLink?.ariaLabel?.trim() ?? '';
    return ariaLabel.length > 0 ? ariaLabel : this.studioBadgeLabel();
  }
}
