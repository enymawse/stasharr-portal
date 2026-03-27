import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

export interface WhisparrAdapterBaseConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface WhisparrMovieLookupResult {
  movieId: number;
  stashId: string;
  hasFile: boolean;
}

export interface WhisparrQueueSnapshotItem {
  movieId: number;
  status: string | null;
  trackedDownloadState: string | null;
  trackedDownloadStatus: string | null;
  errorMessage: string | null;
}

export interface WhisparrRootFolderOption {
  id: number;
  path: string;
  accessible: boolean;
}

export interface WhisparrQualityProfileOption {
  id: number;
  name: string;
}

export interface WhisparrTagOption {
  id: number;
  label: string;
}

export interface WhisparrCreateMovieInput {
  title: string;
  studio: string;
  foreignId: string;
  monitored: boolean;
  rootFolderPath: string;
  addOptions: {
    searchForMovie: boolean;
  };
  qualityProfileId: number;
  tags: number[];
}

export interface WhisparrCreateMovieResult {
  movieId: number | null;
}

@Injectable()
export class WhisparrAdapter {
  private static readonly DEFAULT_QUEUE_PAGE_SIZE = 50;
  private static readonly MAX_QUEUE_PAGES = 200;
  private readonly logger = new Logger(WhisparrAdapter.name);

  async testConnection(config: WhisparrAdapterBaseConfig): Promise<void> {
    await this.fetchJsonPayload(
      this.resolveSystemStatusEndpoint(config.baseUrl),
      config,
    );
  }

  async findMovieByStashId(
    stashId: string,
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrMovieLookupResult | null> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      this.logger.debug(
        'findMovieByStashId called with empty stashId after normalization.',
      );
      return null;
    }

    this.logger.debug(
      `Looking up Whisparr movie by stashId: ${this.safeJson({
        stashId: normalizedStashId,
        baseUrl: config.baseUrl,
        hasApiKey: Boolean(config.apiKey?.trim()),
      })}`,
    );

    const payload = await this.fetchArrayPayload(
      this.resolveMovieLookupEndpoint(config.baseUrl, normalizedStashId),
      config,
    );

    this.logger.debug(
      `Whisparr movie lookup raw payload: ${this.summarizeArrayPayload(payload)}`,
    );

    const matches = payload
      .map((entry) => this.parseMovieLookupEntry(entry))
      .filter(
        (entry): entry is WhisparrMovieLookupResult =>
          entry !== null && entry.stashId === normalizedStashId,
      );

    this.logger.debug(
      `Whisparr movie lookup normalized matches: ${this.safeJson({
        stashId: normalizedStashId,
        matches,
      })}`,
    );

    if (matches.length === 0) {
      return null;
    }

    if (matches.length > 1) {
      this.logger.warn(
        `Whisparr returned multiple movie matches for stashId="${normalizedStashId}"; refusing ambiguous result.`,
      );
      throw new BadGatewayException(
        'Whisparr provider returned multiple movie matches for a stashId lookup.',
      );
    }

    return matches[0];
  }

  async findMovieById(
    movieId: number,
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrMovieLookupResult | null> {
    if (!Number.isInteger(movieId) || movieId <= 0) {
      this.logger.debug(
        `findMovieById called with invalid movieId: ${this.safeJson({
          movieId,
        })}`,
      );
      return null;
    }

    this.logger.debug(
      `Looking up Whisparr movie by movieId: ${this.safeJson({
        movieId,
        baseUrl: config.baseUrl,
        hasApiKey: Boolean(config.apiKey?.trim()),
      })}`,
    );

    const payload = await this.fetchJsonPayload(
      this.resolveMovieByIdEndpoint(config.baseUrl, movieId),
      config,
    );

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      this.logger.error(
        `Whisparr movie-by-id payload has unexpected shape: ${this.safeJson({
          movieId,
          payloadShape: this.describePayloadShape(payload),
          payloadPreview: this.previewPayload(payload),
        })}`,
      );
      throw new BadGatewayException(
        'Whisparr provider returned an unexpected movie-by-id response shape.',
      );
    }

    this.logger.debug(
      `Whisparr movie-by-id raw payload: ${this.safeJson(payload)}`,
    );

    const movie = this.parseMovieLookupEntry(payload);
    if (!movie) {
      this.logger.warn(
        `Whisparr movie-by-id payload could not be normalized: ${this.safeJson({
          movieId,
          payloadPreview: this.previewPayload(payload),
        })}`,
      );
      return null;
    }

    if (movie.movieId !== movieId) {
      this.logger.warn(
        `Whisparr movie-by-id response mismatch: ${this.safeJson({
          requestedMovieId: movieId,
          responseMovieId: movie.movieId,
        })}`,
      );
      return null;
    }

    this.logger.debug(
      `Whisparr movie-by-id normalized result: ${this.safeJson(movie)}`,
    );

    return movie;
  }

  async getQueueSnapshot(
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrQueueSnapshotItem[]> {
    this.logger.debug(
      `Fetching Whisparr queue snapshot: ${this.safeJson({
        baseUrl: config.baseUrl,
        hasApiKey: Boolean(config.apiKey?.trim()),
      })}`,
    );

    const queueRecords = await this.fetchAllQueueRecords(config);

    const normalized = queueRecords
      .map((entry) => this.parseQueueEntry(entry))
      .filter((entry): entry is WhisparrQueueSnapshotItem => entry !== null);

    this.logger.debug(
      `Whisparr queue normalized snapshot: ${this.safeJson({
        count: normalized.length,
        sample: normalized.slice(0, 5),
      })}`,
    );

    return normalized;
  }

  async getRootFolders(
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrRootFolderOption[]> {
    const payload = await this.fetchArrayPayload(
      this.resolveRootFoldersEndpoint(config.baseUrl),
      config,
    );

    return payload
      .map((entry) => this.parseRootFolderEntry(entry))
      .filter((entry): entry is WhisparrRootFolderOption => entry !== null);
  }

  async getQualityProfiles(
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrQualityProfileOption[]> {
    const payload = await this.fetchArrayPayload(
      this.resolveQualityProfilesEndpoint(config.baseUrl),
      config,
    );

    return payload
      .map((entry) => this.parseQualityProfileEntry(entry))
      .filter((entry): entry is WhisparrQualityProfileOption => entry !== null);
  }

  async getTags(config: WhisparrAdapterBaseConfig): Promise<WhisparrTagOption[]> {
    const payload = await this.fetchArrayPayload(
      this.resolveTagsEndpoint(config.baseUrl),
      config,
    );

    return payload
      .map((entry) => this.parseTagEntry(entry))
      .filter((entry): entry is WhisparrTagOption => entry !== null);
  }

  async createMovie(
    input: WhisparrCreateMovieInput,
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrCreateMovieResult> {
    const payload = await this.fetchJsonPayload(
      this.resolveMovieCreateEndpoint(config.baseUrl),
      config,
      {
        method: 'POST',
        body: input,
      },
    );

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      this.logger.error(
        `Whisparr create movie payload has unexpected shape: ${this.safeJson({
          payloadShape: this.describePayloadShape(payload),
          payloadPreview: this.previewPayload(payload),
        })}`,
      );
      throw new BadGatewayException(
        'Whisparr provider returned an unexpected create-movie response shape.',
      );
    }

    const movieId = this.readNumber((payload as Record<string, unknown>).id);
    return { movieId };
  }

  private async fetchAllQueueRecords(
    config: WhisparrAdapterBaseConfig,
  ): Promise<unknown[]> {
    const allRecords: unknown[] = [];
    let page = 1;
    let totalRecords: number | null = null;

    while (page <= WhisparrAdapter.MAX_QUEUE_PAGES) {
      const payload = await this.fetchJsonPayload(
        this.resolveQueueEndpoint(
          config.baseUrl,
          page,
          WhisparrAdapter.DEFAULT_QUEUE_PAGE_SIZE,
        ),
        config,
      );

      const queuePage = this.extractQueuePage(payload);
      allRecords.push(...queuePage.records);
      totalRecords = queuePage.totalRecords;

      this.logger.debug(
        `Whisparr queue page loaded: ${this.safeJson({
          page,
          pageSize: WhisparrAdapter.DEFAULT_QUEUE_PAGE_SIZE,
          fetchedRecords: queuePage.records.length,
          accumulatedRecords: allRecords.length,
          totalRecords,
          sample: queuePage.records.slice(0, 2),
        })}`,
      );

      if (queuePage.records.length === 0) {
        break;
      }

      if (totalRecords !== null && allRecords.length >= totalRecords) {
        break;
      }

      if (
        totalRecords === null &&
        queuePage.records.length < WhisparrAdapter.DEFAULT_QUEUE_PAGE_SIZE
      ) {
        break;
      }

      page += 1;
    }

    if (page > WhisparrAdapter.MAX_QUEUE_PAGES) {
      this.logger.warn(
        `Reached max queue page limit while fetching Whisparr queue: ${this.safeJson(
          {
            maxPages: WhisparrAdapter.MAX_QUEUE_PAGES,
            accumulatedRecords: allRecords.length,
            totalRecords,
          },
        )}`,
      );
    }

    this.logger.debug(
      `Whisparr queue raw payload: ${this.summarizeArrayPayload(allRecords)}`,
    );

    return allRecords;
  }

  buildSceneViewUrl(baseUrl: string, movieId: number): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/movie/${encodeURIComponent(String(movieId))}`;
    parsed.search = '';
    return parsed.toString();
  }

  private async fetchArrayPayload(
    endpoint: string,
    config: WhisparrAdapterBaseConfig,
  ): Promise<unknown[]> {
    const payload = await this.fetchJsonPayload(endpoint, config);

    if (!Array.isArray(payload)) {
      this.logger.error(
        `Whisparr unexpected non-array payload: ${this.safeJson({
          endpoint,
          payloadShape: this.describePayloadShape(payload),
          payloadPreview: this.previewPayload(payload),
        })}`,
      );
      throw new BadGatewayException(
        'Whisparr provider returned an unexpected response shape.',
      );
    }

    return payload;
  }

  private async fetchJsonPayload(
    endpoint: string,
    config: WhisparrAdapterBaseConfig,
    options?: {
      method?: 'GET' | 'POST';
      body?: unknown;
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const method = options?.method ?? 'GET';
    const body = options?.body;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (config.apiKey?.trim()) {
      headers['X-Api-Key'] = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      this.logger.error(
        `Whisparr fetch failed for endpoint: ${endpoint}. error=${this.safeJson(
          this.serializeError(error),
        )}`,
      );
      throw new BadGatewayException(
        'Failed to reach Whisparr provider endpoint.',
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(
        `Whisparr non-OK response: ${this.safeJson({
          endpoint,
          status: response.status,
          body: errorBody,
        })}`,
      );
      throw new BadGatewayException(
        `Whisparr provider returned ${response.status}: ${errorBody}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      this.logger.error(
        `Whisparr returned invalid JSON at endpoint: ${endpoint}. error=${this.safeJson(
          this.serializeError(error),
        )}`,
      );
      throw new BadGatewayException(
        'Whisparr provider returned an invalid JSON response.',
      );
    }

    this.logger.debug(
      `Whisparr JSON payload received: ${this.safeJson({
        endpoint,
        payloadType: Array.isArray(payload) ? 'array' : typeof payload,
        payloadShape: this.describePayloadShape(payload),
      })}`,
    );

    return payload;
  }

  private parseMovieLookupEntry(
    entry: unknown,
  ): WhisparrMovieLookupResult | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const movieId = this.readNumber((entry as Record<string, unknown>).id);
    const stashId = this.readString((entry as Record<string, unknown>).stashId);

    if (movieId === null || !stashId) {
      return null;
    }

    return {
      movieId,
      stashId,
      hasFile: (entry as Record<string, unknown>).hasFile === true,
    };
  }

  private parseQueueEntry(entry: unknown): WhisparrQueueSnapshotItem | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const movieId =
      this.readNumber((entry as Record<string, unknown>).movieId) ??
      this.readNumber(
        ((entry as Record<string, unknown>).movie as Record<string, unknown>)
          ?.id,
      );
    if (movieId === null) {
      return null;
    }

    return {
      movieId,
      status: this.readString((entry as Record<string, unknown>).status),
      trackedDownloadState: this.readString(
        (entry as Record<string, unknown>).trackedDownloadState,
      ),
      trackedDownloadStatus: this.readString(
        (entry as Record<string, unknown>).trackedDownloadStatus,
      ),
      errorMessage: this.readString(
        (entry as Record<string, unknown>).errorMessage,
      ),
    };
  }

  private parseRootFolderEntry(entry: unknown): WhisparrRootFolderOption | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const id = this.readNumber((entry as Record<string, unknown>).id);
    const path = this.readString((entry as Record<string, unknown>).path);
    if (id === null || !path) {
      return null;
    }

    return {
      id,
      path,
      accessible: (entry as Record<string, unknown>).accessible === true,
    };
  }

  private parseQualityProfileEntry(
    entry: unknown,
  ): WhisparrQualityProfileOption | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const id = this.readNumber((entry as Record<string, unknown>).id);
    const name = this.readString((entry as Record<string, unknown>).name);
    if (id === null || !name) {
      return null;
    }

    return {
      id,
      name,
    };
  }

  private parseTagEntry(entry: unknown): WhisparrTagOption | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const id = this.readNumber((entry as Record<string, unknown>).id);
    const label = this.readString((entry as Record<string, unknown>).label);
    if (id === null || !label) {
      return null;
    }

    return {
      id,
      label,
    };
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return value;
  }

  private resolveMovieLookupEndpoint(baseUrl: string, stashId: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');

    parsed.pathname = `${cleanPath}/api/v3/movie`;
    parsed.searchParams.set('stashId', stashId);

    return parsed.toString();
  }

  private resolveMovieByIdEndpoint(baseUrl: string, movieId: number): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');

    parsed.pathname = `${cleanPath}/api/v3/movie/${encodeURIComponent(String(movieId))}`;
    parsed.search = '';

    return parsed.toString();
  }

  private resolveQueueEndpoint(
    baseUrl: string,
    page: number,
    pageSize: number,
  ): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');

    parsed.pathname = `${cleanPath}/api/v3/queue`;
    parsed.searchParams.set('page', String(page));
    parsed.searchParams.set('pageSize', String(pageSize));

    return parsed.toString();
  }

  private resolveRootFoldersEndpoint(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/api/v3/rootFolder`;
    parsed.search = '';
    return parsed.toString();
  }

  private resolveQualityProfilesEndpoint(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/api/v3/qualityprofile`;
    parsed.search = '';
    return parsed.toString();
  }

  private resolveTagsEndpoint(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/api/v3/tag`;
    parsed.search = '';
    return parsed.toString();
  }

  private resolveMovieCreateEndpoint(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/api/v3/movie`;
    parsed.search = '';
    return parsed.toString();
  }

  private resolveSystemStatusEndpoint(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');

    parsed.pathname = `${cleanPath}/api/v3/system/status`;
    parsed.search = '';

    return parsed.toString();
  }

  private summarizeArrayPayload(payload: unknown[]): string {
    return this.safeJson({
      count: payload.length,
      sample: payload.slice(0, 3),
    });
  }

  private extractQueuePage(payload: unknown): {
    records: unknown[];
    totalRecords: number | null;
  } {
    if (Array.isArray(payload)) {
      return {
        records: payload,
        totalRecords: null,
      };
    }

    if (payload && typeof payload === 'object') {
      const payloadRecord = payload as Record<string, unknown>;
      const records = payloadRecord.records;
      if (Array.isArray(records)) {
        const totalRecords = this.readNumber(payloadRecord.totalRecords);
        this.logger.debug(
          `Whisparr queue payload includes records wrapper: ${this.safeJson({
            topLevelKeys: Object.keys(payloadRecord),
            recordsCount: records.length,
            totalRecords,
          })}`,
        );
        return {
          records,
          totalRecords,
        };
      }
    }

    this.logger.error(
      `Whisparr queue payload has unexpected shape: ${this.safeJson({
        payloadShape: this.describePayloadShape(payload),
        payloadPreview: this.previewPayload(payload),
      })}`,
    );
    throw new BadGatewayException(
      'Whisparr provider returned an unexpected queue response shape.',
    );
  }

  private describePayloadShape(payload: unknown): Record<string, unknown> {
    if (Array.isArray(payload)) {
      return {
        kind: 'array',
        length: payload.length,
      };
    }

    if (payload && typeof payload === 'object') {
      const objectPayload = payload as Record<string, unknown>;
      return {
        kind: 'object',
        keys: Object.keys(objectPayload),
      };
    }

    return {
      kind: typeof payload,
    };
  }

  private previewPayload(payload: unknown): unknown {
    if (Array.isArray(payload)) {
      return payload.slice(0, 3);
    }

    if (payload && typeof payload === 'object') {
      const objectPayload = payload as Record<string, unknown>;
      const keyValues = Object.fromEntries(
        Object.entries(objectPayload).slice(0, 8),
      );
      return keyValues;
    }

    return payload;
  }

  private safeJson(value: unknown): string {
    try {
      const serialized = JSON.stringify(value, null, 2);
      if (!serialized) {
        return 'null';
      }
      return serialized.length > 3000
        ? `${serialized.slice(0, 3000)}...(truncated)`
        : serialized;
    } catch {
      return '[unserializable]';
    }
  }

  private serializeError(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return {
      type: typeof error,
      value: error,
    };
  }
}
