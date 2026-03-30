import { Routes } from '@angular/router';
import {
  requireSetupCompleteGuard,
  setupOnlyWhenIncompleteGuard,
} from './core/guards/setup-route.guard';
import { AppShellLayoutComponent } from './layouts/app-shell-layout/app-shell-layout.component';
import { SetupPageComponent } from './features/setup/setup-page.component';
import { AcquisitionPageComponent } from './pages/acquisition/acquisition-page.component';
import { LibraryPageComponent } from './pages/library/library-page.component';
import { ScenesPageComponent } from './pages/scenes/scenes-page.component';
import { ScenePageComponent } from './pages/scene/scene-page.component';
import { SettingsPageComponent } from './pages/settings/settings-page.component';
import { PerformersPageComponent } from './pages/performers/performers-page.component';
import { PerformerPageComponent } from './pages/performer/performer-page.component';
import { StudiosPageComponent } from './pages/studios/studios-page.component';
import { StudioPageComponent } from './pages/studio/studio-page.component';

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
        path: 'home',
        loadComponent: () =>
          import('./pages/home/home-page.component').then((module) => module.HomePageComponent),
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
        path: 'acquisition',
        component: AcquisitionPageComponent,
      },
      {
        path: 'library',
        component: LibraryPageComponent,
      },
      {
        path: 'performers',
        component: PerformersPageComponent,
      },
      {
        path: 'studios',
        component: StudiosPageComponent,
      },
      {
        path: 'performer/:performerId',
        component: PerformerPageComponent,
      },
      {
        path: 'studio/:studioId',
        component: StudioPageComponent,
      },
      {
        path: 'settings',
        component: SettingsPageComponent,
      },
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'home',
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
