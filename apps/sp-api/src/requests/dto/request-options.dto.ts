export class RequestOptionsSceneDto {
  stashId!: string;
  title!: string;
  studio!: string | null;
}

export class RequestOptionsDefaultsDto {
  monitored!: boolean;
  searchForMovie!: boolean;
}

export class RequestOptionsRootFolderDto {
  id!: number;
  path!: string;
  accessible!: boolean;
}

export class RequestOptionsQualityProfileDto {
  id!: number;
  name!: string;
}

export class RequestOptionsTagDto {
  id!: number;
  label!: string;
}

export class RequestOptionsDto {
  scene!: RequestOptionsSceneDto;
  defaults!: RequestOptionsDefaultsDto;
  rootFolders!: RequestOptionsRootFolderDto[];
  qualityProfiles!: RequestOptionsQualityProfileDto[];
  tags!: RequestOptionsTagDto[];
}
