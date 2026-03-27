import { routes } from './app.routes';

describe('app routes', () => {
  it('exposes /acquisition and removes /requests', () => {
    const appShellChildren = routes.find((route) => route.path === '')?.children ?? [];

    expect(appShellChildren.some((route) => route.path === 'acquisition')).toBe(true);
    expect(appShellChildren.some((route) => route.path === 'requests')).toBe(false);
  });
});
