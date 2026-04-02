import { RuntimeHealthController } from './runtime-health.controller';
import { RuntimeHealthService } from './runtime-health.service';

describe('RuntimeHealthController', () => {
  it('returns the runtime health summary from the service', async () => {
    const runtimeHealthService = {
      getSummary: jest.fn().mockResolvedValue({
        degraded: true,
        failureThreshold: 2,
        services: {
          catalog: {
            service: 'CATALOG',
            status: 'DEGRADED',
            degraded: true,
            consecutiveFailures: 2,
            lastHealthyAt: null,
            lastFailureAt: '2026-04-02T00:00:00.000Z',
            lastErrorMessage: 'catalog down',
            degradedAt: '2026-04-02T00:00:00.000Z',
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
            status: 'HEALTHY',
            degraded: false,
            consecutiveFailures: 0,
            lastHealthyAt: null,
            lastFailureAt: null,
            lastErrorMessage: null,
            degradedAt: null,
          },
        },
      }),
    } as unknown as RuntimeHealthService;

    const controller = new RuntimeHealthController(runtimeHealthService);

    await expect(controller.getSummary()).resolves.toMatchObject({
      degraded: true,
      failureThreshold: 2,
      services: {
        catalog: {
          degraded: true,
          lastErrorMessage: 'catalog down',
        },
      },
    });
    expect(runtimeHealthService.getSummary).toHaveBeenCalledTimes(1);
  });
});
