import { BadGatewayException, Injectable } from '@nestjs/common';

export interface StashAdapterBaseConfig {
  baseUrl: string;
  apiKey?: string | null;
}

export interface StashSceneMatch {
  id: string;
  width: number | null;
  height: number | null;
  viewUrl: string;
  label: string;
}

interface StashGraphqlResponse {
  data?: {
    findScenes?: {
      count?: unknown;
      scenes?: Array<{
        id?: unknown;
        files?: Array<{
          width?: unknown;
          height?: unknown;
        }>;
      }>;
    };
  };
  errors?: Array<{ message?: unknown }>;
}

@Injectable()
export class StashAdapter {
  async testConnection(config: StashAdapterBaseConfig): Promise<void> {
    const query = `
      query ConnectivityCheck {
        __typename
      }
    `;

    await this.executeQuery(config, query);
  }

  async findScenesByStashId(
    stashId: string,
    config: StashAdapterBaseConfig,
  ): Promise<StashSceneMatch[]> {
    const normalizedStashId = stashId.trim();
    if (!normalizedStashId) {
      return [];
    }

    const query = `
      query FindScenes($stashId: String!) {
        findScenes(
          scene_filter: {
            stash_id_endpoint: {
              modifier: EQUALS
              stash_id: $stashId
            }
          }
        ) {
          count
          scenes {
            id
            files {
              height
              width
            }
          }
        }
      }
    `;

    const payload = await this.executeQuery(config, query, {
      stashId: normalizedStashId,
    });

    const scenes = payload.data?.findScenes?.scenes ?? [];

    return scenes
      .map((scene): StashSceneMatch | null => {
        if (typeof scene.id !== 'string' || scene.id.trim().length === 0) {
          return null;
        }

        const { width, height } = this.pickBestResolution(scene.files ?? []);

        return {
          id: scene.id,
          width,
          height,
          viewUrl: this.resolveSceneViewUrl(config.baseUrl, scene.id),
          label: this.buildSceneLabel(scene.id, height),
        };
      })
      .filter((scene): scene is StashSceneMatch => scene !== null)
      .sort((a, b) => {
        const aHeight = a.height ?? 0;
        const bHeight = b.height ?? 0;
        if (bHeight !== aHeight) {
          return bHeight - aHeight;
        }

        return a.id.localeCompare(b.id);
      });
  }

  private pickBestResolution(
    files: Array<{ width?: unknown; height?: unknown }>,
  ): { width: number | null; height: number | null } {
    if (files.length === 0) {
      return { width: null, height: null };
    }

    return files.reduce<{ width: number | null; height: number | null }>(
      (best, file) => {
        const width = typeof file.width === 'number' ? file.width : null;
        const height = typeof file.height === 'number' ? file.height : null;
        const bestHeight = best.height ?? 0;
        const currentHeight = height ?? 0;

        if (currentHeight > bestHeight) {
          return { width, height };
        }

        if (currentHeight === bestHeight) {
          const bestWidth = best.width ?? 0;
          const currentWidth = width ?? 0;
          if (currentWidth > bestWidth) {
            return { width, height };
          }
        }

        return best;
      },
      { width: null, height: null },
    );
  }

  private buildSceneLabel(id: string, height: number | null): string {
    if (height && height > 0) {
      return `${height}p`;
    }

    return `Scene #${id}`;
  }

  private async executeQuery(
    config: StashAdapterBaseConfig,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<StashGraphqlResponse> {
    const endpoint = this.resolveGraphqlEndpoint(config.baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (config.apiKey?.trim()) {
      headers.ApiKey = config.apiKey.trim();
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
      });
    } catch {
      throw new BadGatewayException('Failed to reach Stash provider endpoint.');
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new BadGatewayException(
        `Stash provider returned ${response.status}: ${errorBody}`,
      );
    }

    const payload = (await response.json()) as StashGraphqlResponse;

    if (payload.errors && payload.errors.length > 0) {
      const firstError = payload.errors[0]?.message;
      const message =
        typeof firstError === 'string' && firstError.length > 0
          ? firstError
          : 'Stash GraphQL request failed.';
      throw new BadGatewayException(message);
    }

    return payload;
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

  private resolveSceneViewUrl(baseUrl: string, sceneId: string): string {
    const parsed = new URL(baseUrl);
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${cleanPath}/scene/${encodeURIComponent(sceneId)}`;
    parsed.search = '';
    return parsed.toString();
  }
}
