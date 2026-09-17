/**
 * Moves the active snapshot pointer to an already-persisted snapshot.
 *
 * This is the rollback path. It never derives, never contacts the market
 * database, and never writes a snapshot; it only names one that already exists.
 * Snapshots are immutable and are not pruned, so any previously generated
 * snapshot remains a valid target indefinitely.
 */
import "dotenv/config";
import { Pool } from "pg";
import { parseArgs } from "node:util";
import {
  readActiveSnapshot,
  activateSnapshot,
  tryAcquireRefreshLock,
  releaseRefreshLock,
} from "../../src/lib/derived-market/active-snapshot";
import { METHOD } from "../../src/lib/derived-market/model";

const { values: args } = parseArgs({
  options: {
    snapshot: { type: "string" },
    note: { type: "string" },
    list: { type: "boolean", default: false },
  },
});

const url = process.env.DERIVED_MARKET_DATABASE_URL;
let pool: Pool | undefined;
let client;
let locked = false;
try {
  if (!url) throw new Error("EXPLICIT_DERIVED_MARKET_DATABASE_URL_REQUIRED");
  pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 10000,
  });
  client = await pool.connect();

  if (args.list || !args.snapshot) {
    const active = await readActiveSnapshot(client);
    const { rows } = await client.query(
      `select s.id, s.method, s.created_at, s.scope->>'from' as scope_from, s.scope->>'to' as scope_to,
              (select count(*) from derived_market_features f where f.snapshot_id=s.id) as features
         from derived_market_snapshots s order by s.created_at desc limit 25`,
    );
    console.info(
      JSON.stringify(
        {
          event: "derived.activate.list",
          active,
          snapshots: rows.map((r) => ({
            snapshotId: r.id,
            method: r.method,
            createdAt: new Date(r.created_at as string).toISOString(),
            scopeFrom: r.scope_from,
            scopeTo: r.scope_to,
            featureRows: Number(r.features),
            isActive: r.id === active?.snapshotId,
          })),
        },
        null,
        2,
      ),
    );
    if (!args.snapshot && !args.list) throw new Error("SNAPSHOT_ID_REQUIRED");
  }

  if (args.snapshot) {
    // Refuse a snapshot this build cannot read, and refuse one that does not
    // exist — the foreign key would refuse it anyway, with a worse message.
    const { rows } = await client.query(
      "select method from derived_market_snapshots where id=$1",
      [args.snapshot],
    );
    if (!rows.length) throw new Error("SNAPSHOT_NOT_FOUND");
    if (rows[0].method !== METHOD) throw new Error("INCOMPATIBLE_METHOD");
    // Shares the refresh lock so a rollback cannot land between a running
    // refresh's validation and its activation.
    locked = await tryAcquireRefreshLock(client);
    if (!locked) throw new Error("REFRESH_LOCK_HELD_ELSEWHERE");
    const previous = await readActiveSnapshot(client);
    const active = await activateSnapshot(
      client,
      args.snapshot,
      "activate",
      args.note ?? "manual activation",
    );
    console.info(
      JSON.stringify({
        event: "derived.activate",
        previous,
        active,
      }),
    );
  }
} catch (error) {
  const message =
    error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "ACTIVATION_FAILED";
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
