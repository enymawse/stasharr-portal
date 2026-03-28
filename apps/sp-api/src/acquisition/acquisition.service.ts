import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  Prisma,
  SceneIndex,
  SceneLifecycle,
} from '@prisma/client';
import { IndexingService } from '../indexing/indexing.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { withStashImageSize } from '../providers/stashdb/stashdb-image-url.util';
import { WhisparrAdapter } from '../providers/whisparr/whisparr.adapter';
import {
  AcquisitionCountsByLifecycleDto,
  AcquisitionSceneItemDto,
  AcquisitionScenesFeedDto,
} from './dto/acquisition-scene-feed.dto';
import {
  AcquisitionLifecycle,
  AcquisitionLifecycleFilter,
} from './dto/acquisition-scenes-query.dto';

@Injectable()
export class AcquisitionService {
  private static readonly DEFAULT_PAGE = 1;
  private static readonly DEFAULT_PER_PAGE = 25;
  private static readonly ACQUISITION_LIFECYCLES: SceneLifecycle[] = [
    SceneLifecycle.REQUESTED,
    SceneLifecycle.DOWNLOADING,
    SceneLifecycle.IMPORT_PENDING,
    SceneLifecycle.FAILED,
  ];

  constructor(
    private readonly indexingService: IndexingService,
    private readonly integrationsService: IntegrationsService,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly prisma: PrismaService,
  ) {}

  async getScenesFeed(
    page = AcquisitionService.DEFAULT_PAGE,
    perPage = AcquisitionService.DEFAULT_PER_PAGE,
    lifecycle: AcquisitionLifecycleFilter = 'ANY',
  ): Promise<AcquisitionScenesFeedDto> {
    const where = this.buildWhereClause(lifecycle);
    const [rows, total, countsByLifecycle, whisparrConfig] = await Promise.all([
      this.prisma.sceneIndex.findMany({
        where,
        orderBy: [
          {
            lifecycleSortOrder: 'asc',
          },
          {
            whisparrQueuePosition: 'asc',
          },
          {
            requestUpdatedAt: 'desc',
          },
          {
            whisparrMovieId: 'asc',
          },
          {
            stashId: 'asc',
          },
        ],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.sceneIndex.count({ where }),
      this.getCountsByLifecycle(),
      this.getWhisparrConfig(),
    ]);

    const missingMetadataIds = rows
      .filter((row) => this.needsMetadataHydration(row))
      .map((row) => row.stashId);
    if (missingMetadataIds.length > 0) {
      this.indexingService.requestMetadataHydrationForStashIds(
        missingMetadataIds,
        'acquisition-page',
      );
    }

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      countsByLifecycle,
      items: rows.map((row) =>
        this.toAcquisitionItem(row, whisparrConfig?.baseUrl ?? null),
      ),
    };
  }

  private async getCountsByLifecycle(): Promise<AcquisitionCountsByLifecycleDto> {
    const [requested, downloading, importPending, failed] =
      await this.prisma.$transaction([
        this.prisma.sceneIndex.count({
          where: {
            computedLifecycle: SceneLifecycle.REQUESTED,
          },
        }),
        this.prisma.sceneIndex.count({
          where: {
            computedLifecycle: SceneLifecycle.DOWNLOADING,
          },
        }),
        this.prisma.sceneIndex.count({
          where: {
            computedLifecycle: SceneLifecycle.IMPORT_PENDING,
          },
        }),
        this.prisma.sceneIndex.count({
          where: {
            computedLifecycle: SceneLifecycle.FAILED,
          },
        }),
      ]);

    return {
      REQUESTED: requested,
      DOWNLOADING: downloading,
      IMPORT_PENDING: importPending,
      FAILED: failed,
    };
  }

  private buildWhereClause(
    lifecycle: AcquisitionLifecycleFilter,
  ): Prisma.SceneIndexWhereInput {
    if (lifecycle === 'ANY') {
      return {
        computedLifecycle: {
          in: AcquisitionService.ACQUISITION_LIFECYCLES,
        },
      };
    }

    return {
      computedLifecycle: lifecycle as SceneLifecycle,
    };
  }

  private needsMetadataHydration(row: SceneIndex): boolean {
    return !row.title || !row.metadataLastSyncedAt;
  }

  private toAcquisitionItem(
    row: SceneIndex,
    whisparrBaseUrl: string | null,
  ): AcquisitionSceneItemDto {
    const title = row.title?.trim() || row.stashId;
    const description =
      row.description ??
      (row.title ? null : 'Scene metadata is unavailable in StashDB.');

    return {
      id: row.stashId,
      title,
      description,
      imageUrl: row.imageUrl,
      cardImageUrl: row.imageUrl ? withStashImageSize(row.imageUrl, 600) : null,
      studioId: row.studioId,
      studio: row.studioName,
      studioImageUrl: row.studioImageUrl,
      releaseDate: row.releaseDate,
      duration: row.duration,
      type: 'SCENE',
      source: 'STASHDB',
      status: this.indexingService.toSceneStatus(row),
      whisparrViewUrl:
        whisparrBaseUrl && row.whisparrMovieId !== null
          ? this.whisparrAdapter.buildSceneViewUrl(
              whisparrBaseUrl,
              row.whisparrMovieId,
            )
          : null,
    };
  }

  private async getWhisparrConfig(): Promise<{
    baseUrl: string;
    apiKey: string | null;
  } | null> {
    try {
      const integration = await this.integrationsService.findOne(
        IntegrationType.WHISPARR,
      );

      if (!integration.enabled) {
        return null;
      }

      if (integration.status !== IntegrationStatus.CONFIGURED) {
        return null;
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
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      return null;
    }
  }
}
