import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MediaService } from './media.service';

@Controller('api/media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get('stash/scenes/:sceneId/screenshot')
  async getStashSceneScreenshot(
    @Param('sceneId') sceneId: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.mediaService.getStashSceneScreenshot(sceneId);
    this.writeAssetResponse(asset, response);
  }

  @Get('stash/studios/:studioId/logo')
  async getStashStudioLogo(
    @Param('studioId') studioId: string,
    @Res() response: Response,
  ): Promise<void> {
    const asset = await this.mediaService.getStashStudioLogo(studioId);
    this.writeAssetResponse(asset, response);
  }

  private writeAssetResponse(
    asset: Awaited<ReturnType<MediaService['getStashSceneScreenshot']>>,
    response: Response,
  ): void {
    response.setHeader('Content-Type', asset.contentType ?? 'application/octet-stream');
    response.setHeader('Content-Length', asset.contentLength ?? String(asset.body.byteLength));
    if (asset.cacheControl) {
      response.setHeader('Cache-Control', asset.cacheControl);
    }
    response.status(200).end(asset.body);
  }
}
