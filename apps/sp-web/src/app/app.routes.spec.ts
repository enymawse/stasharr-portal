import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

describe('app routes', () => {
  it('keeps the canonical app-shell routes aligned with the consolidated discovery model', () => {
    const appShellChildren = routes.find((route) => route.path === '')?.children ?? [];
    const paths = appShellChildren.map((route) => route.path);

    expect(paths).toEqual([
      'home',
      'scene/:stashId',
      'scenes',
      'acquisition',
      'library',
      'performers',
      'studios',
      'performer/:performerId',
      'studio/:studioId',
      'settings/indexing',
      'settings',
      '',
    ]);
  });
});
