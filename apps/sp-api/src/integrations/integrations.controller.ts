import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { IntegrationType } from '@prisma/client';
import { IntegrationResponseDto } from './dto/integration-response.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';
import { IntegrationsService } from './integrations.service';

@Controller('api/integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  async findAll(): Promise<IntegrationResponseDto[]> {
    const integrations = await this.integrationsService.findAll();
    return integrations.map((integration) => this.toResponseDto(integration));
  }

  @Put(':type')
  async update(
    @Param('type') type: string,
    @Body() dto: UpdateIntegrationDto,
  ): Promise<IntegrationResponseDto> {
    const normalizedType = this.parseIntegrationType(type);
    const integration = await this.integrationsService.upsert(
      normalizedType,
      dto,
    );

    return this.toResponseDto(integration);
  }

  @Post(':type/test')
  async test(
    @Param('type') type: string,
    @Body() dto: UpdateIntegrationDto,
  ): Promise<IntegrationResponseDto> {
    const normalizedType = this.parseIntegrationType(type);
    const integration = await this.integrationsService.testIntegration(
      normalizedType,
      dto,
    );

    return this.toResponseDto(integration);
  }

  @Delete(':type')
  async reset(@Param('type') type: string): Promise<IntegrationResponseDto> {
    const normalizedType = this.parseIntegrationType(type);
    const integration = await this.integrationsService.reset(normalizedType);
    return this.toResponseDto(integration);
  }

  @Delete()
  async resetAll(): Promise<IntegrationResponseDto[]> {
    const integrations = await this.integrationsService.resetAll();
    return integrations.map((integration) => this.toResponseDto(integration));
  }

  private parseIntegrationType(type: string): IntegrationType {
    const normalized = type.toUpperCase();

    if (
      !Object.values(IntegrationType).includes(normalized as IntegrationType)
    ) {
      throw new BadRequestException(`Unsupported integration type: ${type}`);
    }

    return normalized as IntegrationType;
  }

  private toResponseDto(integration: {
    type: IntegrationType;
    enabled: boolean;
    status: string;
    name: string | null;
    baseUrl: string | null;
    apiKey: string | null;
    lastHealthyAt: Date | null;
    lastErrorAt: Date | null;
    lastErrorMessage: string | null;
  }): IntegrationResponseDto {
    return {
      type: integration.type,
      enabled: integration.enabled,
      status: integration.status as IntegrationResponseDto['status'],
      name: integration.name,
      baseUrl: integration.baseUrl,
      hasApiKey: !!integration.apiKey,
      lastHealthyAt: integration.lastHealthyAt?.toISOString() ?? null,
      lastErrorAt: integration.lastErrorAt?.toISOString() ?? null,
      lastErrorMessage: integration.lastErrorMessage,
    };
  }
}
