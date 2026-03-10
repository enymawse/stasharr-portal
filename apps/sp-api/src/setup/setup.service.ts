import { Injectable } from '@nestjs/common';
import { IntegrationStatus, IntegrationType } from '@prisma/client';
import { IntegrationsService } from '../integrations/integrations.service';

export interface SetupStatusResponse {
  setupComplete: boolean;
  required: {
    stash: boolean;
    whisparr: boolean;
    stashdb: boolean;
  };
}

@Injectable()
export class SetupService {
  constructor(private readonly integrationsService: IntegrationsService) {}

  async getStatus(): Promise<SetupStatusResponse> {
    const integrations = await this.integrationsService.findAll();

    const isConfigured = (type: IntegrationType): boolean =>
      integrations.some(
        (integration) =>
          integration.type === type &&
          integration.status === IntegrationStatus.CONFIGURED,
      );

    const required = {
      stash: isConfigured(IntegrationType.STASH),
      whisparr: isConfigured(IntegrationType.WHISPARR),
      stashdb: isConfigured(IntegrationType.STASHDB),
    };

    return {
      setupComplete: required.stash && required.whisparr,
      required,
    };
  }
}
