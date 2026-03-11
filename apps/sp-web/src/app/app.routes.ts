import { Routes } from '@angular/router';
import { DiscoverPageComponent } from './features/discover/discover-page.component';
import { SetupPageComponent } from './features/setup/setup-page.component';

export const routes: Routes = [
  {
    path: 'setup',
    component: SetupPageComponent,
  },
  {
    path: 'discover',
    component: DiscoverPageComponent,
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'setup',
  },
  {
    path: '**',
    redirectTo: 'setup',
  },
];
