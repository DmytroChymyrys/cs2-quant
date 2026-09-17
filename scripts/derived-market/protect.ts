/**
 * Durable snapshot protection.
 *
 * A --protect flag on the retention command only protects a snapshot on the run
 * where somebody remembers to type it. This records the protection in the
 * database, where the foreign key on derived_protected_snapshots makes the
 * deletion physically impossible until the protection is retired on purpose.
 */
import "dotenv/config";
import { Pool } from "pg";
import { parseArgs } from "node:util";
import {
  protectSnapshot,
  unprotectSnapshot,
  RetentionPrecondition,
} from "../../src/lib/derived-market/retention";
import { requireDerivedDatabaseUrl } from "../../src/lib/derived-market/config";

const { values: args } = parseArgs({
  options: {
    snapshot: { type: "string" },
    reason: { type: "string" },
    remove: { type: "boolean", default: false },
    list: { type: "boolean", default: false },
  },
});

let pool: Pool | undefined;
let client;
try {
  pool = new Pool({
    connectionString: requireDerivedDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  client = await pool.connect();
  if (args.snapshot) {
    if (!/^[a-f0-9]{64}$/.test(args.snapshot))
      throw new Error("INVALID_SNAPSHOT_ID");
    if (args.remove) {
      const removed = await unprotectSnapshot(client, args.snapshot);
      if (!removed) throw new Error("SNAPSHOT_WAS_NOT_PROTECTED");
    } else {
      if (!args.reason) throw new Error("PROTECTION_REASON_REQUIRED");
      await protectSnapshot(client, args.snapshot, args.reason, "operator");
    }
  } else if (!args.list) {
    throw new Error("SNAPSHOT_ID_OR_LIST_REQUIRED");
  }
  const { rows } = await client.query(
    "select snapshot_id, reason, protected_by, protected_at from derived_protected_snapshots order by protected_at desc",
  );
  console.info(
    JSON.stringify(
      {
        event: "derived.protect",
        action: args.snapshot
          ? args.remove
            ? "REMOVED"
            : "PROTECTED"
          : "LIST",
        snapshot: args.snapshot ?? null,
        protected: rows.map((r) => ({
          snapshotId: r.snapshot_id,
          reason: r.reason,
          protectedBy: r.protected_by,
          protectedAt: new Date(r.protected_at).toISOString(),
        })),
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message =
    error instanceof RetentionPrecondition
      ? error.code
      : error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "PROTECTION_FAILED";
  console.error(message);
  process.exitCode = 2;
} finally {
  client?.release();
  await pool?.end();
}
