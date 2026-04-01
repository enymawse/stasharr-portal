import { IntegrationResponseDto } from './integration-response.dto';

export class IntegrationTestResponseDto extends IntegrationResponseDto {
  declare status: 'CONFIGURED' | 'ERROR';
}
