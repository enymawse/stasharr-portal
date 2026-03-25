import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { StashAdapter, type StashProtectedAssetResponse } from '../providers/stash/stash.adapter';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stashAdapter: StashAdapter,
  ) {}

  async getStashSceneScreenshot(sceneId: string): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openSceneScreenshot(sceneId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  async getStashStudioLogo(studioId: string): Promise<StashProtectedAssetResponse> {
    const config = await this.getStashConfig();
    const asset = await this.stashAdapter.openStudioLogo(studioId, config);
    if (!asset) {
      throw new NotFoundException('Stash media asset not found.');
    }

    return asset;
  }

  private async getStashConfig(): Promise<{ baseUrl: string; apiKey?: string | null }> {
    const integration = await this.prisma.integrationConfig.findUnique({
      where: { type: 'STASH' },
    });
    const baseUrl = integration?.baseUrl?.trim();

    if (!integration || !integration.enabled || integration.status !== 'CONFIGURED' || !baseUrl) {
      throw new ServiceUnavailableException('Stash media is unavailable.');
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }
}
