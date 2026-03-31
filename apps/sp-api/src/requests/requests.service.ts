import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  Request,
  RequestStatus,
} from '@prisma/client';
import { IndexingService } from '../indexing/indexing.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
import { StashdbAdapter } from '../providers/stashdb/stashdb.adapter';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import { RequestOptionsDto } from './dto/request-options.dto';
import { SubmitSceneRequestDto } from './dto/submit-scene-request.dto';
import { SubmitSceneRequestResponseDto } from './dto/submit-scene-request-response.dto';

@Injectable()
export class RequestsService {
  constructor(
    private readonly indexingService: IndexingService,
    private readonly integrationsService: IntegrationsService,
    private readonly catalogProviderService: CatalogProviderService,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly stashdbAdapter: StashdbAdapter,
    private readonly prisma: PrismaService,
  ) {}

  async getRequestOptions(stashId: string): Promise<RequestOptionsDto> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const whisparrConfig = await this.getWhisparrConfig();
    const catalogConfig = await this.getActiveCatalogConfig();

    const scene = await this.stashdbAdapter.getSceneById(
      normalizedStashId,
      catalogConfig,
    );

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.whisparrAdapter.getRootFolders(whisparrConfig),
      this.whisparrAdapter.getQualityProfiles(whisparrConfig),
      this.whisparrAdapter.getTags(whisparrConfig),
    ]);

    if (rootFolders.filter((folder) => folder.accessible).length === 0) {
      throw new ConflictException(
        'No accessible Whisparr root folders are available.',
      );
    }

    if (qualityProfiles.length === 0) {
      throw new ConflictException(
        'No Whisparr quality profiles are available.',
      );
    }

    return {
      scene: {
        stashId: scene.id,
        title: scene.title,
        studio: scene.studioName,
      },
      defaults: {
        monitored: true,
        searchForMovie: true,
      },
      rootFolders,
      qualityProfiles,
      tags,
    };
  }

  async submitSceneRequest(
    stashId: string,
    dto: SubmitSceneRequestDto,
  ): Promise<SubmitSceneRequestResponseDto> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      throw new BadRequestException('Scene stashId is required.');
    }

    const whisparrConfig = await this.getWhisparrConfig();
    const catalogConfig = await this.getActiveCatalogConfig();

    const scene = await this.stashdbAdapter.getSceneById(
      normalizedStashId,
      catalogConfig,
    );
    const title = scene.title.trim();
    const studio = scene.studioName?.trim() ?? '';

    if (!title) {
      throw new ConflictException(
        'Scene metadata is missing a title required for Whisparr submission.',
      );
    }

    if (!studio) {
      throw new ConflictException(
        'Scene metadata is missing a studio required for Whisparr submission.',
      );
    }

    const existingMovie = await this.whisparrAdapter.findMovieByStashId(
      normalizedStashId,
      whisparrConfig,
    );
    if (existingMovie) {
      const request = await this.upsertLocalRequestRow(normalizedStashId);
      await this.indexingService.seedRequestedScene({
        stashId: normalizedStashId,
        requestStatus: request.status,
        requestUpdatedAt: request.updatedAt,
        title: scene.title,
        description: scene.details,
        imageUrl: scene.imageUrl,
        studioId: scene.studioId,
        studioName: scene.studioName,
        studioImageUrl: scene.studioImageUrl,
        releaseDate: scene.releaseDate,
        duration: scene.duration,
        whisparrMovieId: existingMovie.movieId,
        whisparrHasFile: existingMovie.hasFile,
      });
      void this.indexingService.requestImmediateRefresh(
        [normalizedStashId],
        'request-existing-movie',
      );
      return {
        accepted: true,
        alreadyExists: true,
        stashId: normalizedStashId,
        whisparrMovieId: existingMovie.movieId,
      };
    }

    const [rootFolders, qualityProfiles, tags] = await Promise.all([
      this.whisparrAdapter.getRootFolders(whisparrConfig),
      this.whisparrAdapter.getQualityProfiles(whisparrConfig),
      this.whisparrAdapter.getTags(whisparrConfig),
    ]);

    if (rootFolders.filter((folder) => folder.accessible).length === 0) {
      throw new ConflictException(
        'No accessible Whisparr root folders are available.',
      );
    }

    if (qualityProfiles.length === 0) {
      throw new ConflictException(
        'No Whisparr quality profiles are available.',
      );
    }

    const selectedRootFolder = rootFolders.find(
      (folder) => folder.path === dto.rootFolderPath,
    );
    if (!selectedRootFolder) {
      throw new BadRequestException(
        'Selected root folder does not exist in Whisparr.',
      );
    }
    if (!selectedRootFolder.accessible) {
      throw new BadRequestException(
        'Selected root folder is not accessible in Whisparr.',
      );
    }

    const selectedQualityProfile = qualityProfiles.find(
      (profile) => profile.id === dto.qualityProfileId,
    );
    if (!selectedQualityProfile) {
      throw new BadRequestException(
        'Selected quality profile does not exist in Whisparr.',
      );
    }

    const allowedTagIds = new Set(tags.map((tag) => tag.id));
    for (const tagId of dto.tags) {
      if (!allowedTagIds.has(tagId)) {
        throw new BadRequestException(
          `Selected tag id ${tagId} does not exist in Whisparr.`,
        );
      }
    }

    const createdMovie = await this.whisparrAdapter.createMovie(
      {
        title,
        studio,
        foreignId: normalizedStashId,
        monitored: dto.monitored,
        rootFolderPath: dto.rootFolderPath,
        addOptions: {
          searchForMovie: dto.searchForMovie,
        },
        qualityProfileId: dto.qualityProfileId,
        tags: dto.tags,
      },
      whisparrConfig,
    );

    const request = await this.upsertLocalRequestRow(normalizedStashId);
    await this.indexingService.seedRequestedScene({
      stashId: normalizedStashId,
      requestStatus: request.status,
      requestUpdatedAt: request.updatedAt,
      title: scene.title,
      description: scene.details,
      imageUrl: scene.imageUrl,
      studioId: scene.studioId,
      studioName: scene.studioName,
      studioImageUrl: scene.studioImageUrl,
      releaseDate: scene.releaseDate,
      duration: scene.duration,
      whisparrMovieId: createdMovie.movieId ?? undefined,
      whisparrHasFile: false,
    });
    void this.indexingService.requestImmediateRefresh(
      [normalizedStashId],
      'request-submitted',
    );

    return {
      accepted: true,
      alreadyExists: false,
      stashId: normalizedStashId,
      whisparrMovieId: createdMovie.movieId ?? null,
    };
  }

  private async upsertLocalRequestRow(stashId: string): Promise<Request> {
    return this.prisma.request.upsert({
      where: { stashId },
      create: {
        stashId,
        status: RequestStatus.REQUESTED,
      },
      update: {
        status: RequestStatus.REQUESTED,
      },
    });
  }

  private async getWhisparrConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const integration = await this.getIntegration(IntegrationType.WHISPARR);

    if (!integration.enabled) {
      throw new ConflictException('WHISPARR integration is disabled.');
    }

    if (integration.status !== IntegrationStatus.CONFIGURED) {
      throw new ConflictException('WHISPARR integration is not configured.');
    }

    const baseUrl = integration.baseUrl?.trim();
    if (!baseUrl) {
      throw new BadRequestException(
        'WHISPARR integration is missing a base URL.',
      );
    }

    return {
      baseUrl,
      apiKey: integration.apiKey,
    };
  }

  private async getActiveCatalogConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  }> {
    const catalogProvider =
      await this.catalogProviderService.getConfiguredCatalogProvider();

    return {
      baseUrl: catalogProvider.baseUrl,
      apiKey: catalogProvider.apiKey,
    };
  }

  private async getIntegration(type: IntegrationType) {
    try {
      return await this.integrationsService.findOne(type);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ConflictException(
          `${type} integration has not been created yet.`,
        );
      }

      throw error;
    }
  }
}
