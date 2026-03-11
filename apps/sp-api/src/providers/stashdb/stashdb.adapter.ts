import { BadGatewayException, Injectable } from '@nestjs/common';

export interface StashdbAdapterConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface StashdbTrendingScene {
  id: string;
  title: string;
  imageUrl: string | null;
  studio: string | null;
  releaseDate: string | null;
  sourceUrl: string | null;
}

interface StashdbGraphqlResponse {
  data?: {
    queryScenes?: Array<{
      id?: unknown;
      title?: unknown;
    }>;
  };
  errors?: Array<{ message?: unknown }>;
}

@Injectable()
export class StashdbAdapter {
  async getTrendingScenes(
    config: StashdbAdapterConfig,
  ): Promise<StashdbTrendingScene[]> {
    const endpoint = this.resolveGraphqlEndpoint(config.baseUrl);

    const query = `
      query QueryScenes {
        queryScenes(input: { sort: TRENDING }) {
          count
          scenes {
            id
            title
            details
            date
            release_date
            created
            updated
            production_date
            images {
              id
              url
              width
              height
            }
            studio {
              id
              name
            }
            duration
          }
        }
      }
    `;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.apiKey?.trim()) {
      headers.ApiKey = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
      });
    } catch {
      throw new BadGatewayException(
        'Failed to reach StashDB provider endpoint.',
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new BadGatewayException(
        `StashDB provider returned ${response.status}: ${errorBody}`,
      );
    }

    const payload = (await response.json()) as StashdbGraphqlResponse;

    if (payload.errors && payload.errors.length > 0) {
      const firstError = payload.errors[0]?.message;
      const message =
        typeof firstError === 'string' && firstError.length > 0
          ? firstError
          : 'StashDB GraphQL request failed.';
      throw new BadGatewayException(message);
    }

    const scenes = payload.data?.queryScenes ?? [];

    return scenes
      .map((scene): StashdbTrendingScene | null => {
        if (typeof scene.id !== 'string' || typeof scene.title !== 'string') {
          return null;
        }

        return {
          id: scene.id,
          title: scene.title,
          imageUrl: null,
          studio: null,
          releaseDate: null,
          sourceUrl: null,
        };
      })
      .filter((scene): scene is StashdbTrendingScene => scene !== null);
  }

  private resolveGraphqlEndpoint(baseUrl: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');

    if (cleanPath.endsWith('/graphql')) {
      return parsed.toString();
    }

    parsed.pathname = `${cleanPath}/graphql`;
    return parsed.toString();
  }
}
