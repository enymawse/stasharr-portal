import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  IntegrationStatus,
  IntegrationType,
  MetadataHydrationState,
  Prisma,
  SceneIndex,
  SceneLifecycle,
} from '@prisma/client';
import { IndexingService } from '../indexing/indexing.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogProviderService } from '../providers/catalog/catalog-provider.service';
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
  private static readonly DEFAULT_PER_PAGE = 24;
  private static readonly ACQUISITION_LIFECYCLES: SceneLifecycle[] = [
    SceneLifecycle.REQUESTED,
    SceneLifecycle.DOWNLOADING,
    SceneLifecycle.IMPORT_PENDING,
    SceneLifecycle.FAILED,
  ];
  private readonly logger = new Logger(AcquisitionService.name);

  constructor(
    private readonly indexingService: IndexingService,
    private readonly integrationsService: IntegrationsService,
    private readonly catalogProviderService: CatalogProviderService,
    private readonly whisparrAdapter: WhisparrAdapter,
    private readonly prisma: PrismaService,
  ) {}

  async getScenesFeed(
    page = AcquisitionService.DEFAULT_PAGE,
    perPage = AcquisitionService.DEFAULT_PER_PAGE,
    lifecycle: AcquisitionLifecycleFilter = 'ANY',
  ): Promise<AcquisitionScenesFeedDto> {
    const startedAt = Date.now();
    const where = this.buildWhereClause(lifecycle);
    const [rows, summary, whisparrConfig, catalogProviderType] =
      await Promise.all([
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
      this.indexingService.getSceneIndexSummary(),
      this.getWhisparrConfig(),
      this.catalogProviderService.getConfiguredCatalogProviderType(),
    ]);
    const countsByLifecycle = this.toCountsByLifecycle(summary);
    const total =
      lifecycle === 'ANY'
        ? summary.acquisitionTrackedScenes
        : this.getLifecycleTotal(countsByLifecycle, lifecycle);

    const missingMetadataIds = rows
      .filter((row) => this.needsMetadataHydration(row))
      .map((row) => row.stashId);
    if (missingMetadataIds.length > 0) {
      this.indexingService.requestMetadataHydrationForStashIds(
        missingMetadataIds,
        'acquisition-page',
      );
    }

    this.logger.debug(
      `Acquisition feed served from summary: ${JSON.stringify({
        page,
        perPage,
        lifecycle,
        total,
        rowCount: rows.length,
        durationMs: Date.now() - startedAt,
      })}`,
    );

    return {
      total,
      page,
      perPage,
      hasMore: page * perPage < total,
      countsByLifecycle,
      items: rows.map((row) =>
        this.toAcquisitionItem(
          row,
          whisparrConfig?.baseUrl ?? null,
          catalogProviderType ?? 'STASHDB',
        ),
      ),
    };
  }

  private toCountsByLifecycle(summary: {
    requestedCount: number;
    downloadingCount: number;
    importPendingCount: number;
    failedCount: number;
  }): AcquisitionCountsByLifecycleDto {
    return {
      REQUESTED: summary.requestedCount,
      DOWNLOADING: summary.downloadingCount,
      IMPORT_PENDING: summary.importPendingCount,
      FAILED: summary.failedCount,
    };
  }

  private getLifecycleTotal(
    countsByLifecycle: AcquisitionCountsByLifecycleDto,
    lifecycle: AcquisitionLifecycle,
  ): number {
    return countsByLifecycle[lifecycle];
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
    if (row.metadataHydrationState === MetadataHydrationState.PENDING) {
      return true;
    }

    if (
      row.metadataHydrationState !== MetadataHydrationState.FAILED_RETRYABLE
    ) {
      return false;
    }

    if (!row.metadataRetryAfterAt) {
      return true;
    }

    return row.metadataRetryAfterAt.getTime() <= Date.now();
  }

  private toAcquisitionItem(
    row: SceneIndex,
    whisparrBaseUrl: string | null,
    source: 'STASHDB' | 'FANSDB',
  ): AcquisitionSceneItemDto {
    const title = row.title?.trim() || row.stashId;
    const description =
      row.description ??
      (row.title
        ? null
        : 'Scene metadata is unavailable from the catalog provider configured for this instance.');

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
      source,
      status: this.indexingService.toSceneStatus(row),
      queueStatus: row.whisparrQueueStatus,
      queueState: row.whisparrQueueState,
      errorMessage: row.whisparrErrorMessage,
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
