import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StashAdapter } from '../providers/stash/stash.adapter';
import { MediaService } from './media.service';

describe('MediaService', () => {
  const integrationFindUniqueMock = jest.fn();
  const openSceneScreenshotMock = jest.fn();
  const openStudioLogoMock = jest.fn();

  const prismaService = {
    integrationConfig: {
      findUnique: integrationFindUniqueMock,
    },
  } as unknown as PrismaService;

  const stashAdapter = {
    openSceneScreenshot: openSceneScreenshotMock,
    openStudioLogo: openStudioLogoMock,
  } as unknown as StashAdapter;

  let service: MediaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MediaService(prismaService, stashAdapter);
  });

  it('returns a proxied scene screenshot using stash integration credentials', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openSceneScreenshotMock.mockResolvedValue({
      body,
      contentType: 'image/jpeg',
      contentLength: '128',
      cacheControl: 'public, max-age=300',
    });

    const result = await service.getStashSceneScreenshot('411');

    expect(integrationFindUniqueMock).toHaveBeenCalledWith({
      where: { type: 'STASH' },
    });
    expect(openSceneScreenshotMock).toHaveBeenCalledWith('411', {
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    expect(result).toEqual({
      body,
      contentType: 'image/jpeg',
      contentLength: '128',
      cacheControl: 'public, max-age=300',
    });
  });

  it('returns a proxied studio logo using stash integration credentials', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local/base',
      apiKey: null,
    });
    openStudioLogoMock.mockResolvedValue({
      body,
      contentType: 'image/png',
      contentLength: null,
      cacheControl: null,
    });

    const result = await service.getStashStudioLogo('studio-1');

    expect(openStudioLogoMock).toHaveBeenCalledWith('studio-1', {
      baseUrl: 'http://stash.local/base',
      apiKey: null,
    });
    expect(result.contentType).toBe('image/png');
  });

  it('throws not found when stash returns no matching media asset', async () => {
    integrationFindUniqueMock.mockResolvedValue({
      type: 'STASH',
      enabled: true,
      status: 'CONFIGURED',
      baseUrl: 'http://stash.local',
      apiKey: 'secret',
    });
    openSceneScreenshotMock.mockResolvedValue(null);

    await expect(service.getStashSceneScreenshot('411')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws service unavailable when stash is not configured', async () => {
    integrationFindUniqueMock.mockResolvedValue(null);

    await expect(service.getStashStudioLogo('studio-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(openStudioLogoMock).not.toHaveBeenCalled();
  });
});
