export interface CollectionContext {
  runId: string;
  startedAt: Date;
}
export interface TransformContext extends CollectionContext {
  observedAt: Date;
}
