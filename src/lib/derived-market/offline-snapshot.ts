import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { Feature } from "./model";
import {
  validateSnapshotHead,
  reviewSnapshot,
  type SnapshotHead,
} from "./snapshot-review";
export type SnapshotExport = {
  format: "floatalpha-offline-v1";
  evidence: "SYNTHETIC" | "OBSERVED";
  snapshotId: string;
  head: SnapshotHead;
  features: Feature[];
  historyVersions: number;
};
export function fingerprint(data: SnapshotExport) {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
export function validateExport(data: SnapshotExport) {
  if (
    data.format !== "floatalpha-offline-v1" ||
    !["SYNTHETIC", "OBSERVED"].includes(data.evidence) ||
    !/^[a-f0-9]{64}$/.test(data.snapshotId) ||
    !Array.isArray(data.features) ||
    !Number.isInteger(data.historyVersions) ||
    data.historyVersions < 0
  )
    throw Error("INVALID_SNAPSHOT_EXPORT");
  return reviewSnapshot(
    data.head,
    data.features,
    data.historyVersions,
    new Date().toISOString(),
  );
}
export async function loadOfflineSnapshot(
  db: PoolClient,
  id: string,
  evidence: SnapshotExport["evidence"],
): Promise<SnapshotExport> {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error("EXPLICIT_SNAPSHOT_ID_REQUIRED");
  const head = validateSnapshotHead(
    (
      await db.query(
        "select method,scope,created_at,report from derived_market_snapshots where id=$1",
        [id],
      )
    ).rows[0],
  );
  const features = (
    await db.query(
      "select feature from derived_market_features where snapshot_id=$1 order by asset_id,observed_at,observation_id limit 250001",
      [id],
    )
  ).rows.map((r) => r.feature as Feature);
  const historyVersions = Number(
    (
      await db.query(
        "select count(*) as count from derived_history_versions where snapshot_id=$1",
        [id],
      )
    ).rows[0].count,
  );
  const data: SnapshotExport = {
    format: "floatalpha-offline-v1",
    evidence,
    snapshotId: id,
    head: { ...head, created_at: new Date(head.created_at).toISOString() },
    features,
    historyVersions,
  };
  validateExport(data);
  return data;
}
export function selectionContents(
  existing: string,
  id: string,
  databaseUrl?: string,
) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error("INVALID_SELECTION");
  const configured = databaseUrl
    ? existing
        .split("\n")
        .filter((l) => !/^\s*DERIVED_MARKET_DATABASE_URL\s*=/.test(l))
        .join("\n") +
      `\nDERIVED_MARKET_DATABASE_URL=${JSON.stringify(databaseUrl)}\n`
    : existing;
  return (
    configured
      .split("\n")
      .filter(
        (l) =>
          !/^\s*(?:export\s+)?PRODUCT_ANALYTICS_(MODE|SNAPSHOT_ID)\s*=/.test(l),
      )
      .join("\n")
      .trimEnd() +
    `\nPRODUCT_ANALYTICS_MODE=database\nPRODUCT_ANALYTICS_SNAPSHOT_ID=${id}\n`
  );
}
