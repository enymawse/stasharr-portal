import { Routes } from '@angular/router';
import {
  requireSetupCompleteGuard,
  setupOnlyWhenIncompleteGuard,
} from './core/guards/setup-route.guard';
import { DiscoverPageComponent } from './features/discover/discover-page.component';
import { SetupPageComponent } from './features/setup/setup-page.component';
import { ScenePageComponent } from './pages/scene/scene-page.component';

export const routes: Routes = [
  {
    path: 'setup',
    component: SetupPageComponent,
    canActivate: [setupOnlyWhenIncompleteGuard],
  },
  {
    path: 'discover',
    component: DiscoverPageComponent,
    canActivate: [requireSetupCompleteGuard],
  },
  {
    path: 'scene/:stashId',
    component: ScenePageComponent,
    canActivate: [requireSetupCompleteGuard],
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'discover',
  },
  {
    path: '**',
    redirectTo: 'setup',
  },
];
