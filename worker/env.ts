export interface Env {
  ASSETS: Fetcher;
  ROOM_DO: DurableObjectNamespace;
  PIN_REGISTRY_DO: DurableObjectNamespace;

  QUIZ_DB?: D1Database;
  QUIZ_IMAGES?: R2Bucket;
}
