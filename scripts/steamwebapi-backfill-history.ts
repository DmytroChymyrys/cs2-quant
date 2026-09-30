import "dotenv/config";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { createHash } from "node:crypto";

/**
 * One-time history backfill for the canonical tracked assets.
 *
 * **Plan-only by default.** Execution requires `--apply`, and nothing about
 * deployment triggers it. The discovery probe measured this at roughly one
 * credit per asset against an allowance of 500 per billing period, so a loop
 * started by accident would be expensive and hard to undo.
 *
 * What is being stored is provider-supplied historical evidence retrieved now.
 * A 2014 row does not mean FloatAlpha observed anything in 2014, and the schema
 * keeps that distinction structurally: `observed_date` is the date the provider
 * attributes a value to, `retrieved_at` is when we asked.
 *
 * Idempotent and resumable. The unique constraint on
 * (provider_asset_id, series, observed_date) means a re-run updates in place
 * rather than duplicating, and assets that already have history are skipped
 * unless `--force` is given — so a partial failure is resumed by running the
 * same command again.
 */

const BASE = "https://www.steamwebapi.com";
const SERIES = "steam";
const ENDPOINT = "/steam/api/history";
const COLLECTOR_VERSION = "steamwebapi-history@1";
/** The provider's OTHER bucket allows 2/minute; stay well inside it. */
const DELAY_MS = 31_000;

const { values: args } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    limit: { type: "string" },
    interval: { type: "string", default: "1" },
  },
});

const key = process.env.STEAMWEBAPI_API_KEY?.trim();
if (!key) throw new Error("STEAMWEBAPI_API_KEY_MISSING");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

type Target = {
  providerAssetId: string;
  marketHashName: string;
  existingPoints: number;
};

async function targets(): Promise<Target[]> {
  const { rows } = await pool.query<{
    provider_asset_id: string;
    market_hash_name: string;
    existing: string;
  }>(`
    select pa.id as provider_asset_id, pa.market_hash_name,
           (select count(*) from steam_price_history h
              where h.provider_asset_id = pa.id and h.series = $1) as existing
    from provider_assets pa
    join assets a on a.id = pa.asset_id
    where pa.provider = 'STEAMWEBAPI' and a.is_tracked
    order by pa.market_hash_name
  `, [SERIES]);
  return rows.map((r) => ({
    providerAssetId: r.provider_asset_id,
    marketHashName: r.market_hash_name,
    existingPoints: Number(r.existing),
  }));
}

async function fetchHistory(marketHashName: string) {
  const url = new URL(ENDPOINT, BASE);
  url.searchParams.set("market_hash_name", marketHashName);
  url.searchParams.set("interval", String(args.interval));
  url.searchParams.set("production", "1");
  // Header auth: the credential never enters a URL, a log or an error message.
  const response = await fetch(url, {
    headers: { "X-Api-Key": key!, accept: "application/json" },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const parsed = JSON.parse(text) as unknown;
  const points = Array.isArray(parsed) ? parsed : [];
  return {
    points: points as { createdat?: string; price?: number; sold?: number | null }[],
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

async function store(target: Target, points: Awaited<ReturnType<typeof fetchHistory>>["points"]) {
  const rows = points
    .map((p) => ({
      d: String(p.createdat ?? "").slice(0, 10),
      price: typeof p.price === "number" ? p.price : null,
      sold: typeof p.sold === "number" ? p.sold : null,
    }))
    .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.d));
  if (!rows.length) return 0;
  const result = await pool.query(
    `insert into steam_price_history
       (provider_asset_id, series, observed_date, price, sold,
        retrieved_at, source_endpoint, collector_version)
     select $1::uuid, $2, t.d::date, t.price, t.sold, now(), $4, $5
     from jsonb_to_recordset($3::jsonb) as t(d text, price numeric, sold integer)
     on conflict (provider_asset_id, series, observed_date) do update
       set price = excluded.price, sold = excluded.sold,
           retrieved_at = excluded.retrieved_at`,
    [target.providerAssetId, SERIES, JSON.stringify(rows), ENDPOINT, COLLECTOR_VERSION],
  );
  return result.rowCount ?? 0;
}

const all = await targets();
const pending = args.force ? all : all.filter((t) => t.existingPoints === 0);
const limited = args.limit ? pending.slice(0, Number(args.limit)) : pending;

console.log(
  JSON.stringify(
    {
      mode: args.apply ? "APPLY" : "PLAN",
      trackedProviderAssets: all.length,
      alreadyBackfilled: all.length - pending.length,
      wouldRequest: limited.length,
      estimatedCredits: limited.length,
      endpoint: ENDPOINT,
      series: SERIES,
      interval: args.interval,
      destination: "steam_price_history",
      idempotency: "UNIQUE (provider_asset_id, series, observed_date) — re-run updates in place",
      resume: "assets with existing points are skipped unless --force",
      pacing: `${DELAY_MS}ms between requests (provider allows 2/minute)`,
    },
    null,
    2,
  ),
);

if (!args.apply) {
  console.log("\nPlan only. Re-run with --apply to execute.");
  await pool.end();
  process.exit(0);
}

let written = 0,
  failed = 0,
  requested = 0;
for (const target of limited) {
  try {
    const history = await fetchHistory(target.marketHashName);
    requested += 1;
    written += await store(target, history.points);
    console.log(
      JSON.stringify({
        event: "backfill.asset",
        marketHashName: target.marketHashName,
        points: history.points.length,
        responseSha256: history.sha256,
      }),
    );
  } catch (error) {
    failed += 1;
    console.error(
      JSON.stringify({
        event: "backfill.failed",
        marketHashName: target.marketHashName,
        // A fixed code, never the request URL — that would carry the key.
        error: String((error as Error)?.message ?? "UNKNOWN"),
      }),
    );
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}
console.log(JSON.stringify({ event: "backfill.end", requested, written, failed }));
await pool.end();
