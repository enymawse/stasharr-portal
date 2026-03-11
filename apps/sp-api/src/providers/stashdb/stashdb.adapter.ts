import { BadGatewayException, Injectable } from '@nestjs/common';

export interface StashdbAdapterConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface StashdbTrendingScene {
  id: string;
  title: string;
  details: string | null;
  imageUrl: string | null;
  imageCount: number;
  studioName: string | null;
  releaseDate: string | null;
  productionDate: string | null;
  duration: number | null;
  sourceUrl: string | null;
}

interface StashdbGraphqlResponse {
  data?: {
    queryScenes?: {
      count?: unknown;
      scenes?: Array<{
        id?: unknown;
        title?: unknown;
        details?: unknown;
        date?: unknown;
        release_date?: unknown;
        production_date?: unknown;
        images?: Array<{
          id?: unknown;
          url?: unknown;
          width?: unknown;
          height?: unknown;
        }>;
        studio?: {
          id?: unknown;
          name?: unknown;
        } | null;
        duration?: unknown;
      }>;
    };
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

    const scenes = payload.data?.queryScenes?.scenes ?? [];

    return scenes
      .map((scene): StashdbTrendingScene | null => {
        if (typeof scene.id !== 'string' || typeof scene.title !== 'string') {
          return null;
        }

        const validImages = (scene.images ?? [])
          .filter(
            (
              image,
            ): image is {
              url: string;
              width: number | null;
              height: number | null;
            } => typeof image.url === 'string' && image.url.length > 0,
          )
          .map((image) => ({
            url: image.url,
            width: typeof image.width === 'number' ? image.width : null,
            height: typeof image.height === 'number' ? image.height : null,
          }));

        const primaryImage = validImages.reduce<{
          url: string;
          score: number;
        } | null>((best, image) => {
          const width = image.width ?? 0;
          const height = image.height ?? 0;
          const score = width > 0 && height > 0 ? width * height : 0;

          if (!best || score > best.score) {
            return { url: image.url, score };
          }

          return best;
        }, null);

        const details =
          typeof scene.details === 'string' && scene.details.trim().length > 0
            ? scene.details
            : null;
        const studioName =
          typeof scene.studio?.name === 'string' && scene.studio.name.length > 0
            ? scene.studio.name
            : null;
        const releaseDate =
          typeof scene.release_date === 'string' &&
          scene.release_date.length > 0
            ? scene.release_date
            : typeof scene.date === 'string' && scene.date.length > 0
              ? scene.date
              : null;
        const productionDate =
          typeof scene.production_date === 'string' &&
          scene.production_date.length > 0
            ? scene.production_date
            : null;
        const duration =
          typeof scene.duration === 'number' ? scene.duration : null;

        return {
          id: scene.id,
          title: scene.title,
          details,
          imageUrl: primaryImage?.url ?? validImages[0]?.url ?? null,
          imageCount: validImages.length,
          studioName,
          releaseDate,
          productionDate,
          duration,
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
