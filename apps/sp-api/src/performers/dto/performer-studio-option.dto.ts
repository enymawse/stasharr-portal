export interface PerformerStudioOptionDto {
  id: string;
  name: string;
  childStudios: Array<{
    id: string;
    name: string;
  }>;
}
