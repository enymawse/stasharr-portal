import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';

describe('app routes', () => {
  it('exposes the public auth routes before the protected shell', () => {
    expect(routes.slice(0, 3).map((route) => route.path)).toEqual(['bootstrap', 'login', 'setup']);
  });

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
      'settings',
      '',
    ]);
  });

  it('organizes settings into focused child routes', () => {
    const appShellChildren = routes.find((route) => route.path === '')?.children ?? [];
    const settingsRoute = appShellChildren.find((route) => route.path === 'settings');

    expect(settingsRoute?.children?.map((route) => route.path)).toEqual([
      '',
      'integrations',
      'indexing',
      'account',
      'about',
    ]);
  });
});
