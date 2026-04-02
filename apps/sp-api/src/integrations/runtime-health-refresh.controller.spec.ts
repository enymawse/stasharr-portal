import { RuntimeHealthRefreshController } from './runtime-health-refresh.controller';
import { IntegrationsService } from './integrations.service';

describe('RuntimeHealthRefreshController', () => {
  it('returns the refreshed runtime health summary from integrations', async () => {
    const integrationsService = {
      refreshRuntimeHealth: jest.fn().mockResolvedValue({
        degraded: true,
        failureThreshold: 2,
        services: {
          catalog: {
            service: 'CATALOG',
            status: 'HEALTHY',
            degraded: false,
            consecutiveFailures: 0,
            lastHealthyAt: null,
            lastFailureAt: null,
            lastErrorMessage: null,
            degradedAt: null,
          },
          stash: {
            service: 'STASH',
            status: 'HEALTHY',
            degraded: false,
            consecutiveFailures: 0,
            lastHealthyAt: null,
            lastFailureAt: null,
            lastErrorMessage: null,
            degradedAt: null,
          },
          whisparr: {
            service: 'WHISPARR',
            status: 'DEGRADED',
            degraded: true,
            consecutiveFailures: 2,
            lastHealthyAt: null,
            lastFailureAt: '2026-04-02T00:00:00.000Z',
            lastErrorMessage: 'whisparr down',
            degradedAt: '2026-04-02T00:00:00.000Z',
          },
        },
      }),
    } as unknown as IntegrationsService;

    const controller = new RuntimeHealthRefreshController(integrationsService);

    await expect(controller.refresh()).resolves.toMatchObject({
      degraded: true,
      services: {
        whisparr: {
          degraded: true,
          lastErrorMessage: 'whisparr down',
        },
      },
    });
    expect(integrationsService.refreshRuntimeHealth).toHaveBeenCalledTimes(1);
  });
});
