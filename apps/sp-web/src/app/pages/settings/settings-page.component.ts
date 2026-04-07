import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

interface SettingsNavItem {
  label: string;
  route: string;
  exact?: boolean;
}

@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
})
export class SettingsPageComponent {
  protected readonly navItems: SettingsNavItem[] = [
    {
      label: 'Overview',
      route: '/settings',
      exact: true,
    },
    {
      label: 'Integrations',
      route: '/settings/integrations',
    },
    {
      label: 'Indexing',
      route: '/settings/indexing',
    },
    {
      label: 'Account',
      route: '/settings/account',
    },
    {
      label: 'About',
      route: '/settings/about',
    },
  ];
}
