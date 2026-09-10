import type { MarketDataProvider } from "../domain/provider";
import { rawRetentionConfig } from "../registry/source-config";
export interface RetainedSnapshot {
  runId: string;
  provider: MarketDataProvider;
  endpoint: string;
  payload: string;
  payloadSha256: string;
  createdAt: Date;
  expiresAt: Date;
}
// A future storage adapter MUST enforce expiresAt and size limits, and provide expiry cleanup.
export interface RawSnapshotSink {
  write(snapshot: RetainedSnapshot): Promise<void>;
}
export async function retainRawSnapshot(
  snapshot: Omit<RetainedSnapshot, "expiresAt">,
  sink?: RawSnapshotSink,
  config = rawRetentionConfig(),
): Promise<"DISABLED" | "STORED"> {
  if (!config.enabled) return "DISABLED";
  if (!sink) throw new Error("RAW_SNAPSHOT_SINK_NOT_CONFIGURED");
  if (
    !Number.isInteger(config.days) ||
    config.days < 1 ||
    config.days > 30 ||
    !Number.isFinite(snapshot.createdAt.getTime())
  )
    throw new Error("RAW_RETENTION_CONFIGURATION");
  await sink.write({
    ...snapshot,
    expiresAt: new Date(snapshot.createdAt.getTime() + config.days * 86400000),
  });
  return "STORED";
}
// Not wired into the production collector. Enable only with a separate bounded storage/cleanup implementation.
