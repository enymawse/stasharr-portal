import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const originalStasharrVersion = process.env.STASHARR_VERSION;
  const originalNpmPackageVersion = process.env.npm_package_version;

  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([{ result: 1 }]),
  } as unknown as PrismaService;

  let controller: HealthController;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STASHARR_VERSION;
    delete process.env.npm_package_version;
    controller = new HealthController(prisma);
  });

  afterAll(() => {
    restoreEnv('STASHARR_VERSION', originalStasharrVersion);
    restoreEnv('npm_package_version', originalNpmPackageVersion);
  });

  it('returns STASHARR_VERSION as the app version when it is set', async () => {
    process.env.STASHARR_VERSION = '9.9.9-test';
    process.env.npm_package_version = '0.0.1';

    await expect(controller.getStatus()).resolves.toMatchObject({
      status: 'ok',
      database: 'ok',
      service: 'sp-api',
      version: '9.9.9-test',
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('falls back to npm_package_version when STASHARR_VERSION is unset', async () => {
    process.env.npm_package_version = '1.2.3-local';

    await expect(controller.getStatus()).resolves.toMatchObject({
      version: '1.2.3-local',
    });
  });

  it('falls back to a dev version when no runtime version is available', async () => {
    await expect(controller.getStatus()).resolves.toMatchObject({
      version: '0.0.0-dev',
    });
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
