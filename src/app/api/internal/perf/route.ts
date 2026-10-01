import { Pool } from "pg";
import { authorized } from "@/lib/auth";
import { readMarketDataset } from "@/lib/product/intelligence/server";
import { serverTiming } from "@/lib/product/intelligence/read-timing";
import { resolveDerivedDatabase } from "@/lib/derived-market/config";
import { selectSnapshot } from "@/lib/derived-market/active-snapshot";

/**
 * TEMPORARY diagnostic route. Delete with `read-timing.ts`.
 *
 * Exists so the derived query's plan can be obtained without the connection
 * string ever leaving the server: the EXPLAIN runs here, and only the plan
 * text comes back. Guarded by the same bearer secret as the other internal
 * routes, and read-only — EXPLAIN ANALYZE on a SELECT writes nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Exactly the statement `readMarketDataset` runs, character for character. */
const FEATURES_SQL = `select distinct on(asset_id) asset_id,feature,count(*) over(partition by asset_id)::int as available
        from derived_market_features where snapshot_id=$1 order by asset_id,observed_at desc,observation_id desc limit 1001`;

/**
 * Candidate shapes, measured but NOT adopted.
 *
 * Each returns the same rows as FEATURES_SQL: one row per asset, carrying the
 * newest feature and the count of that asset's rows in the snapshot. They
 * exist to find out whether the cost is the query shape or the data volume,
 * before anyone proposes an index. Read-only; nothing is created.
 */
const CANDIDATES: { name: string; sql: string }[] = [
  {
    // Is the per-asset count alone cheap? It can be served index-only.
    name: "counts_only",
    sql: `select asset_id, count(*)::int as available
          from derived_market_features where snapshot_id=$1 group by asset_id`,
  },
  {
    // Is picking the newest row per asset alone cheap?
    name: "latest_only",
    sql: `select distinct on(asset_id) asset_id, feature
          from derived_market_features where snapshot_id=$1
          order by asset_id, observed_at desc, observation_id desc`,
  },
  {
    // Aggregate for the counts, then one small lookup per asset for the row.
    name: "aggregate_plus_lateral",
    sql: `select c.asset_id, f.feature, c.available
          from (select asset_id, count(*)::int as available
                from derived_market_features where snapshot_id=$1 group by asset_id) c
          cross join lateral (
            select feature from derived_market_features
            where snapshot_id=$1 and asset_id=c.asset_id
            order by observed_at desc, observation_id desc limit 1
          ) f
          limit 1001`,
  },
];

export async function GET(request: Request) {
  if (!authorized(request))
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const wantsExplain =
    new URL(request.url).searchParams.get("explain") === "1";
  try {
    const started = performance.now();
    const dataset = await readMarketDataset();
    const totalMs = Math.round((performance.now() - started) * 10) / 10;

    const body: Record<string, unknown> = {
      totalMs,
      assets: dataset.assets.length,
      evidence: dataset.evidence,
      snapshotId: dataset.snapshotId,
      note: "Stage breakdown is emitted to the log as perf.read_market_dataset.",
    };

    if (wantsExplain) {
      const derived = resolveDerivedDatabase();
      if (!derived.ok) body.explain = { error: derived.code };
      else {
        const pool = new Pool({
          connectionString: derived.url,
          max: 1,
          connectionTimeoutMillis: 10000,
        });
        try {
          const selection = await selectSnapshot(
            pool,
            process.env.PRODUCT_ANALYTICS_SNAPSHOT_ID,
          );
          if (!selection.snapshotId) body.explain = { error: "NO_SNAPSHOT" };
          else {
            const plan = await pool.query(
              `EXPLAIN (ANALYZE, BUFFERS, SUMMARY) ${FEATURES_SQL}`,
              [selection.snapshotId],
            );
            const indexes = await pool.query(
              `select indexdef from pg_indexes where tablename = 'derived_market_features'`,
            );
            const size = await pool.query(
              `select pg_size_pretty(pg_total_relation_size('derived_market_features')) as size,
                      (select count(*) from derived_market_features where snapshot_id = $1)::int as snapshot_rows,
                      (select count(*) from derived_market_features)::bigint as total_rows`,
              [selection.snapshotId],
            );
            const candidates: Record<string, unknown> = {};
            for (const candidate of CANDIDATES) {
              try {
                const p = await pool.query(
                  `EXPLAIN (ANALYZE, BUFFERS, SUMMARY) ${candidate.sql}`,
                  [selection.snapshotId],
                );
                const text = p.rows.map((r) => r["QUERY PLAN"]).join("\n");
                candidates[candidate.name] = {
                  ms: Number(/Execution Time: ([\d.]+) ms/.exec(text)?.[1] ?? -1),
                  scan: /Seq Scan|Index Only Scan|Index Scan/.exec(text)?.[0] ?? null,
                  spilledToDisk: /external merge/.test(text),
                  plan: text.split("\n").slice(0, 14),
                };
              } catch {
                candidates[candidate.name] = { error: "EXPLAIN_FAILED" };
              }
            }
            body.explain = {
              sql: FEATURES_SQL,
              plan: plan.rows.map((r) => r["QUERY PLAN"]),
              // Index definitions name columns, not credentials.
              indexes: indexes.rows.map((r) => r.indexdef),
              size: size.rows[0],
              candidates,
            };
          }
        } finally {
          await pool.end();
        }
      }
    }
    return Response.json(body, {
      headers: {
        "Cache-Control": "no-store",
        "Server-Timing": serverTiming([], totalMs),
      },
    });
  } catch (e) {
    /*
     * Never the driver message: it can carry the connection string. The same
     * rule the dataset reader follows.
     */
    return Response.json(
      { error: "PROBE_FAILED", kind: e instanceof Error ? e.name : "unknown" },
      { status: 500 },
    );
  }
}
