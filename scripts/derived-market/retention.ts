/**
 * Derived snapshot retention.
 *
 * Dry run is the DEFAULT. Deletion requires --execute, so the destructive form
 * of this command can only ever be reached deliberately.
 *
 * Touches nothing but derived snapshots and their children. There is no
 * connection to the market database in this file.
 */
import "dotenv/config";
import { Pool } from "pg";
import { parseArgs } from "node:util";
import {
  planRetention,
  executeRetention,
  RetentionPrecondition,
} from "../../src/lib/derived-market/retention";
import {
  tryAcquireRefreshLock,
  releaseRefreshLock,
} from "../../src/lib/derived-market/active-snapshot";
import { requireDerivedDatabaseUrl } from "../../src/lib/derived-market/config";

const { values: args } = parseArgs({
  options: {
    /** Repeatable. Typically the snapshot PRODUCT_ANALYTICS_SNAPSHOT_ID pins. */
    protect: { type: "string", multiple: true, default: [] },
    "keep-previous": { type: "string" },
    execute: { type: "boolean", default: false },
  },
});

const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;
let pool: Pool | undefined;
let client;
let locked = false;
try {
  const url = requireDerivedDatabaseUrl();
  const pinned = (args.protect ?? []).map((s) => s.trim()).filter(Boolean);
  for (const id of pinned)
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("INVALID_PROTECTED_ID");
  const keepPrevious = args["keep-previous"]
    ? Number(args["keep-previous"])
    : undefined;

  pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  client = await pool.connect();
  // Shares the refresh lock: retention must not classify snapshots while a
  // refresh is between validating a candidate and activating it.
  locked = await tryAcquireRefreshLock(client);
  if (!locked) throw new Error("REFRESH_LOCK_HELD_ELSEWHERE");

  const plan = await planRetention(client, { pinned, keepPrevious });
  const summary = {
    event: "derived.retention",
    mode: args.execute ? "EXECUTE" : "DRY_RUN",
    active: plan.active,
    rollback: plan.rollback,
    protected: plan.protectedIds,
    pinned: plan.pinnedIds,
    candidates: plan.candidates,
    reclaimable: { ...plan.reclaimable, megabytes: mb(plan.reclaimable.bytes) },
    snapshots: plan.snapshots.map((s) => ({
      snapshotId: s.snapshotId,
      createdAt: s.createdAt,
      scope: `${s.scopeFrom} .. ${s.scopeTo}`,
      featureRows: s.featureRows,
      megabytes: mb(s.bytes),
      disposition: s.keptBecause ?? "DELETE",
      detail: s.detail,
    })),
  };

  if (!args.execute) {
    // The dry run reports and stops. Nothing above this point writes.
    console.info(JSON.stringify({ ...summary, deleted: [] }, null, 2));
  } else {
    const result = await executeRetention(client, { pinned, keepPrevious });
    console.info(
      JSON.stringify(
        {
          ...summary,
          deleted: result.deleted,
          rowsDeleted: result.rowsDeleted,
          bytesReclaimed: result.bytesReclaimed,
          megabytesReclaimed: mb(result.bytesReclaimed),
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  const message =
    error instanceof RetentionPrecondition
      ? error.code
      : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "RETENTION_FAILED";
  console.error(message);
  process.exitCode = 2;
} finally {
  try {
    if (client && locked) await releaseRefreshLock(client);
  } finally {
    client?.release();
  }
  await pool?.end();
}
