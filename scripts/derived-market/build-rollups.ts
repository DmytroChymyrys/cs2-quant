/**
 * Builds L2 hourly and daily rollups and reconciles them against raw
 * observations. Rollups are derived caches: this only ever rewrites the rollup
 * tables, never market_observations.
 *
 *   --from / --to        window (defaults to the frozen 7-day experiment)
 *   --database-url       target (defaults to STAGING_DATABASE_URL)
 *   --reconcile-only     skip building; reconcile what is already stored
 *   --out                write the JSON result to this path
 */
import "dotenv/config";
import { Pool } from "pg";
import { parseArgs } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  buildRollup,
  reconcile,
  type Grain,
} from "../../src/lib/derived-market/rollups";

const EXPERIMENT = {
  from: "2026-09-09T17:55:00.000Z",
  to: "2026-09-16T17:55:00.000Z",
};
const { values: args } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    "database-url": { type: "string" },
    "reconcile-only": { type: "boolean", default: false },
    out: { type: "string" },
  },
});
const url = args["database-url"] ?? process.env.STAGING_DATABASE_URL;
if (!url) throw new Error("EXPLICIT_DATABASE_URL_REQUIRED");
const from = args.from ?? EXPERIMENT.from;
const to = args.to ?? EXPERIMENT.to;
if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to)))
  throw new Error("INVALID_WINDOW");

const pool = new Pool({
  connectionString: url,
  max: 1,
  connectionTimeoutMillis: 15000,
  statement_timeout: 600000,
});
const started = Date.now();
try {
  const built: unknown[] = [];
  const reconciliations = [];
  for (const grain of ["hourly", "daily"] as Grain[]) {
    if (!args["reconcile-only"]) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        built.push(await buildRollup(client, grain, from, to));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    reconciliations.push(await reconcile(pool, grain, from, to));
  }
  const result = {
    target: new URL(url).host + new URL(url).pathname,
    window: { from, to },
    mode: args["reconcile-only"] ? "reconcile-only" : "build",
    built,
    reconciliations,
    elapsedMs: Date.now() - started,
    matches: reconciliations.every((r) => r.matches),
  };
  if (args.out) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(result, null, 2) + "\n");
  }
  console.info(JSON.stringify(result, null, 2));
  if (!result.matches) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({
      code: "ROLLUP_FAILED",
      message: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
