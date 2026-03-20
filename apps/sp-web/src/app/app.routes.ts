import { Routes } from '@angular/router';
import {
  requireSetupCompleteGuard,
  setupOnlyWhenIncompleteGuard,
} from './core/guards/setup-route.guard';
import { AppShellLayoutComponent } from './layouts/app-shell-layout/app-shell-layout.component';
import { DiscoverPageComponent } from './features/discover/discover-page.component';
import { SetupPageComponent } from './features/setup/setup-page.component';
import { ScenesPageComponent } from './pages/scenes/scenes-page.component';
import { ScenePageComponent } from './pages/scene/scene-page.component';
import { SettingsPageComponent } from './pages/settings/settings-page.component';
import { RequestsPageComponent } from './pages/requests/requests-page.component';
import { PerformersPageComponent } from './pages/performers/performers-page.component';
import { PerformerPageComponent } from './pages/performer/performer-page.component';

export const routes: Routes = [
  {
    path: 'setup',
    component: SetupPageComponent,
    canActivate: [setupOnlyWhenIncompleteGuard],
  },
  {
    path: '',
    component: AppShellLayoutComponent,
    canActivate: [requireSetupCompleteGuard],
    children: [
      {
        path: 'discover',
        component: DiscoverPageComponent,
      },
      {
        path: 'scene/:stashId',
        component: ScenePageComponent,
      },
      {
        path: 'scenes',
        component: ScenesPageComponent,
      },
      {
        path: 'requests',
        component: RequestsPageComponent,
      },
      {
        path: 'performers',
        component: PerformersPageComponent,
      },
      {
        path: 'performer/:performerId',
        component: PerformerPageComponent,
      },
      {
        path: 'settings',
        component: SettingsPageComponent,
      },
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'discover',
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
