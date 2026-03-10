export interface SetupStatusResponse {
  setupComplete: boolean;
  required: {
    stash: boolean;
    stashdb: boolean;
    whisparr: boolean;
  };
}
