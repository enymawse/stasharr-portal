import { BadGatewayException, Injectable } from '@nestjs/common';

export interface WhisparrAdapterBaseConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface WhisparrSceneLookupResult {
  stashId: string;
  available: boolean;
}

@Injectable()
export class WhisparrAdapter {
  async findSceneByStashId(
    stashId: string,
    config: WhisparrAdapterBaseConfig,
  ): Promise<WhisparrSceneLookupResult | null> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      return null;
    }

    const endpoint = this.resolveMovieLookupEndpoint(
      config.baseUrl,
      normalizedStashId,
    );
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (config.apiKey?.trim()) {
      headers['X-Api-Key'] = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers,
      });
    } catch {
      throw new BadGatewayException(
        'Failed to reach Whisparr provider endpoint.',
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new BadGatewayException(
        `Whisparr provider returned ${response.status}: ${errorBody}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BadGatewayException(
        'Whisparr provider returned an invalid JSON response.',
      );
    }

    if (!Array.isArray(payload)) {
      throw new BadGatewayException(
        'Whisparr provider returned an unexpected response shape.',
      );
    }

    const matches = payload
      .map((entry) => this.parseMovieLookupEntry(entry))
      .filter(
        (entry): entry is WhisparrSceneLookupResult =>
          entry !== null && entry.stashId === normalizedStashId,
      );

    if (matches.length === 0) {
      return null;
    }

    return {
      stashId: normalizedStashId,
      available: matches.some((entry) => entry.available),
    };
  }

  private parseMovieLookupEntry(
    entry: unknown,
  ): WhisparrSceneLookupResult | null {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const stashId = this.readString((entry as Record<string, unknown>).stashId);
    if (!stashId) {
      return null;
    }

    const hasFile = (entry as Record<string, unknown>).hasFile === true;
    const isAvailable = (entry as Record<string, unknown>).isAvailable === true;

    return {
      stashId,
      available: hasFile || isAvailable,
    };
  }

  private readString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private resolveMovieLookupEndpoint(baseUrl: string, stashId: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');

    parsed.pathname = `${cleanPath}/api/v3/movie`;
    parsed.searchParams.set('stashId', stashId);

    return parsed.toString();
  }
}
