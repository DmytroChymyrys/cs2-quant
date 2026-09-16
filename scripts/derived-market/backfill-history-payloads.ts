/**
 * L1 backfill: link every observation to a content-addressed History payload.
 *
 * Idempotent and resumable — it only ever INSERTs rows that are not yet linked,
 * so re-running after an interruption continues where it stopped. It never
 * writes to market_observations: that table is append-only by trigger, and
 * raw_history_payload remains the authoritative copy throughout.
 *
 *   --database-url   target database (defaults to STAGING_DATABASE_URL)
 *   --batch          observations per transaction (default 2000)
 *   --verify-only    skip linking; run verification and measurement only
 *   --out            write the JSON result to this path
 */
import "dotenv/config";
import { Pool } from "pg";
import { parseArgs } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  upsertPayloads,
  linkPayloads,
  refreshPayloadCounts,
  verifyLinks,
} from "../../src/lib/derived-market/history-dedup";

const { values: args } = parseArgs({
  options: {
    "database-url": { type: "string" },
    batch: { type: "string", default: "2000" },
    "verify-only": { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const url = args["database-url"] ?? process.env.STAGING_DATABASE_URL;
const batchSize = Number(args.batch);
if (!url) throw new Error("EXPLICIT_DATABASE_URL_REQUIRED");
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20000)
  throw new Error("BATCH_MUST_BE_AN_INTEGER_BETWEEN_1_AND_20000");

const pool = new Pool({
  connectionString: url,
  max: 1,
  connectionTimeoutMillis: 15000,
  statement_timeout: 300000,
});

async function linkBatch(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertPayloads(client, batchSize);
    const linked = await linkPayloads(client, batchSize);
    await client.query("COMMIT");
    return linked;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function refreshCounts() {
  await refreshPayloadCounts(pool);
}

async function verify() {
  return verifyLinks(pool);
}

/** Measured, not projected: real relation sizes on the target database. */
async function measure() {
  const r = await pool.query(
    `select
       (select count(*)::int from market_observations) as observation_rows,
       pg_total_relation_size('market_observations')::bigint as observations_total_bytes,
       pg_relation_size('market_observations')::bigint as observations_heap_bytes,
       pg_indexes_size('market_observations')::bigint as observations_index_bytes,
       (select coalesce(sum(pg_column_size(raw_history_payload)),0)::bigint from market_observations) as raw_history_datum_bytes,
       (select coalesce(sum(pg_column_size(raw_item_payload)),0)::bigint from market_observations) as raw_item_datum_bytes,
       coalesce(to_regclass('market_history_payloads') is not null, false) as dedup_present,
       coalesce(pg_total_relation_size('market_history_payloads'),0)::bigint as payload_table_total_bytes,
       coalesce(pg_total_relation_size('market_observation_history'),0)::bigint as link_table_total_bytes,
       (select coalesce(sum(pg_column_size(payload)),0)::bigint from market_history_payloads) as dedup_payload_datum_bytes`,
  );
  const m = r.rows[0];
  const rows = Number(m.observation_rows) || 1;
  const rawHistory = Number(m.raw_history_datum_bytes);
  const dedupTotal =
    Number(m.payload_table_total_bytes) + Number(m.link_table_total_bytes);
  return {
    ...Object.fromEntries(
      Object.entries(m).map(([k, v]) => [
        k,
        typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v,
      ]),
    ),
    rawHistoryBytesPerObservation: rawHistory / rows,
    dedupReplacementTotalBytes: dedupTotal,
    historyBytesSaved: rawHistory - dedupTotal,
    historyReductionPct: rawHistory
      ? (100 * (rawHistory - dedupTotal)) / rawHistory
      : null,
    basis:
      "Measured relation and datum sizes on the target database. Saving compares the summed raw_history_payload datum bytes against the full deduplicated payload table plus link table, including their indexes.",
  };
}

const started = Date.now();
let linkedTotal = 0,
  batches = 0;
try {
  if (!args["verify-only"]) {
    for (;;) {
      const n = await linkBatch();
      if (!n) break;
      linkedTotal += n;
      batches++;
      if (batches % 10 === 0)
        console.info(
          JSON.stringify({ event: "backfill.progress", batches, linkedTotal }),
        );
    }
    await refreshCounts();
  }
  const verification = await verify();
  const measurement = await measure();
  const result = {
    target: new URL(url).host + new URL(url).pathname,
    mode: args["verify-only"] ? "verify-only" : "backfill",
    batchSize,
    batches,
    linked: linkedTotal,
    elapsedMs: Date.now() - started,
    verification,
    measurement,
    passed:
      verification.byteIdenticalMismatches === 0 && verification.unlinked === 0,
  };
  if (args.out) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(result, null, 2) + "\n");
  }
  console.info(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      code: "BACKFILL_FAILED",
      message: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
