/**
 * Verifies the product read path against a real derived snapshot: the same
 * query server.ts issues, mapped through map.ts and filtered through
 * screener.ts. Proves real observations reach the Screener surface without
 * needing a browser.
 *
 *   --database-url  derived analytics database
 *   --snapshot      snapshot id
 *   --out           write the JSON result to this path
 */
import "dotenv/config";
import { Pool } from "pg";
import { parseArgs } from "node:util";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Feature } from "../../src/lib/derived-market/model";
import {
  validateSnapshotHead,
  validateFeature,
} from "../../src/lib/derived-market/snapshot-review";
import { summary } from "../../src/lib/product/intelligence/map";
import {
  screenAssets,
  screenInput,
  whySurfaced,
  explain,
  PRESETS,
  SCREEN_THRESHOLDS,
} from "../../src/lib/product/intelligence/screener";

const { values: args } = parseArgs({
  options: {
    "database-url": { type: "string" },
    snapshot: { type: "string" },
    out: { type: "string" },
  },
});
const url = args["database-url"] ?? process.env.DERIVED_MARKET_DATABASE_URL;
const snapshotId = args.snapshot ?? process.env.PRODUCT_ANALYTICS_SNAPSHOT_ID;
if (!url || !snapshotId) throw new Error("DATABASE_URL_AND_SNAPSHOT_REQUIRED");

const pool = new Pool({
  connectionString: url,
  max: 2,
  statement_timeout: 60000,
  options: "-c default_transaction_read_only=on",
});
try {
  const head = await pool.query(
    "select method,scope,created_at,report from derived_market_snapshots where id=$1",
    [snapshotId],
  );
  const metadata = validateSnapshotHead(head.rows[0]);
  const scope = metadata.scope;
  const rows = await pool.query(
    `select distinct on(asset_id) asset_id,feature,count(*) over(partition by asset_id)::int as available
     from derived_market_features where snapshot_id=$1 order by asset_id,observed_at desc,observation_id desc limit 1001`,
    [snapshotId],
  );
  const expected = (Date.parse(scope.to) - Date.parse(scope.from)) / 300000;
  const asOf = scope.to;
  for (const r of rows.rows) validateFeature(r.feature, scope);
  const assets = rows.rows.map((r) =>
    summary(r.feature as Feature, r.available, expected, asOf, null),
  );

  const presetYield = Object.fromEntries(
    (["1h", "6h", "24h"] as const).map((horizon) => [
      horizon,
      Object.fromEntries(
        Object.keys(PRESETS).map((preset) => [
          preset,
          screenAssets(assets, screenInput({ preset, horizon })).total,
        ]),
      ),
    ]),
  );
  // A single failed provider window makes every complete-window metric null for
  // a full horizon afterwards. That is correct: gaps are never bridged.
  const completeWindowMetrics = Object.fromEntries(
    (["1h", "6h", "24h"] as const).map((h) => [
      h,
      {
        minimumVolatility: assets.filter((a) => a.volatility[h] !== null)
          .length,
        medianVolatility: assets.filter((a) => a.medianVolatility[h] !== null)
          .length,
      },
    ]),
  );
  const basisDisagreement = assets.filter((a) => {
    const m = a.returns["24h"],
      d = a.medianReturns["24h"];
    return (
      m !== null && d !== null && Math.sign(Number(m)) !== Math.sign(Number(d))
    );
  });
  const thin = assets.filter((a) => a.listings !== null && a.listings <= 5);
  const movers = screenAssets(
    assets,
    screenInput({ preset: "movers", horizon: "24h" }),
  );
  const sample = movers.assets.slice(0, 3).map((a) => ({
    name: a.name,
    listings: a.listings,
    minimumReturn24h: a.returns["24h"],
    medianReturn24h: a.medianReturns["24h"],
    listingPct24h: a.listingPct["24h"],
    activity1h: a.activity,
    activity24h: a.activity24h,
    minimumVolatility24h: a.volatility["24h"],
    medianVolatility24h: a.medianVolatility["24h"],
    whySurfaced: whySurfaced(
      a,
      screenInput({ preset: "movers", horizon: "24h" }),
    ),
    explanation: explain(a, screenInput({ preset: "movers", horizon: "24h" })),
  }));

  const result = {
    snapshotId,
    method: metadata.method,
    scope,
    assetsRendered: assets.length,
    expectedObservationsPerAsset: expected,
    thresholds: SCREEN_THRESHOLDS,
    presetYieldOutOf: assets.length,
    presetYield,
    completeWindowMetrics,
    activity24hPopulated: assets.filter((a) => a.activity24h !== null).length,
    medianFieldsPopulated: {
      medianReturn24h: assets.filter((a) => a.medianReturns["24h"] !== null)
        .length,
      medianVolatility24h: assets.filter(
        (a) => a.medianVolatility["24h"] !== null,
      ).length,
      listingPct24h: assets.filter((a) => a.listingPct["24h"] !== null).length,
      activity24h: assets.filter((a) => a.activity24h !== null).length,
    },
    assetsWhereBasesDisagreeInSign: basisDisagreement.length,
    thinMarkets: thin.map((a) => ({
      name: a.name,
      listings: a.listings,
      minimumReturn24h: a.returns["24h"],
    })),
    sampleMovers: sample,
  };
  if (args.out) {
    await mkdir(dirname(args.out), { recursive: true });
    await writeFile(args.out, JSON.stringify(result, null, 2) + "\n");
  }
  console.info(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      code: "WIRING_VERIFICATION_FAILED",
      message: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
