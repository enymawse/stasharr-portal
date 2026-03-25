import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { MediaService } from './media.service';

@Controller('api/media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get('stash/scenes/:sceneId/screenshot')
  async getStashSceneScreenshot(
    @Param('sceneId') sceneId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const asset = await this.mediaService.getStashSceneScreenshot(sceneId);
    return this.toStreamableFile(asset, response);
  }

  @Get('stash/studios/:studioId/logo')
  async getStashStudioLogo(
    @Param('studioId') studioId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const asset = await this.mediaService.getStashStudioLogo(studioId);
    return this.toStreamableFile(asset, response);
  }

  private toStreamableFile(
    asset: Awaited<ReturnType<MediaService['getStashSceneScreenshot']>>,
    response: Response,
  ): StreamableFile {
    if (asset.cacheControl) {
      response.setHeader('Cache-Control', asset.cacheControl);
    }

    return new StreamableFile(
      Readable.fromWeb(asset.body as unknown as NodeReadableStream<Uint8Array>),
      {
        type: asset.contentType ?? 'application/octet-stream',
        length: asset.contentLength ? Number(asset.contentLength) : undefined,
      },
    );
  }
}
