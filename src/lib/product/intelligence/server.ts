import { catalogIdentity, demoIdentity } from "../../catalog/browsing";
import "server-only";
import { cache } from "react";
import { Pool } from "pg";
import { catalogPresentation } from "../../catalog/presentation";
import type { Feature } from "../../derived-market/model";
import {
  validateSnapshotHead,
  validateFeature,
  snapshotAge,
} from "../../derived-market/snapshot-review";
import { METHOD } from "../../derived-market/model";
import type {
  MarketDataset,
  AssetMarketDetail,
  Horizon,
  MarketHistoryVersion,
} from "./contract";
import { summary, seriesPoint, historyContract } from "./map";
import { FIXTURE_AS_OF, fixtureDataset } from "./fixtures";
import { DEMO_AS_OF, demoDataset } from "./demo";
import { DEMO_UNIVERSE } from "./demo-universe";
import {
  isDemoPreview,
  syntheticDataAllowed,
  assertPreviewIsolation,
} from "../../preview";
export function demoMode() {
  return (
    syntheticDataAllowed() && process.env.PRODUCT_ANALYTICS_MODE === "demo"
  );
}
function previewDataset() {
  return demoMode() ? demoDataset() : fixtureDataset();
}
let pool: Pool | undefined;
export function syntheticMode() {
  return (
    syntheticDataAllowed() &&
    ["fixture", "demo"].includes(process.env.PRODUCT_ANALYTICS_MODE ?? "")
  );
}
function connection() {
  if (!process.env.DERIVED_MARKET_DATABASE_URL)
    throw new Error("ANALYTICS_NOT_CONFIGURED");
  return (pool ??= new Pool({
    connectionString: process.env.DERIVED_MARKET_DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    options: "-c default_transaction_read_only=on",
  }));
}
export const readMarketDataset = cache(async (): Promise<MarketDataset> => {
  assertPreviewIsolation();
  const asOf = syntheticMode()
    ? demoMode()
      ? DEMO_AS_OF
      : FIXTURE_AS_OF
    : new Date().toISOString();
  const unavailable = (error: string): MarketDataset => ({
    snapshotId: null,
    snapshot: null,
    evidence: "UNAVAILABLE",
    asOf,
    scope: null,
    assets: [],
    error,
  });
  if (
    ["fixture", "demo"].includes(process.env.PRODUCT_ANALYTICS_MODE ?? "") &&
    !syntheticMode()
  )
    return unavailable("Synthetic data is disabled in production.");
  try {
    if (syntheticMode()) {
      const d = previewDataset(),
        groups = Map.groupBy(d.features, (f) => f.asset_id),
        expected = (Date.parse(d.scope.to) - Date.parse(d.scope.from)) / 300000;
      return {
        snapshotId: d.snapshotId,
        snapshot: {
          method: METHOD,
          generatedAt: asOf,
          ageSeconds: 0,
          stale: false,
        },
        evidence: "SYNTHETIC",
        preview: demoMode() ? "DEMO" : "QA",
        asOf,
        scope: d.scope,
        error: null,
        assets: [...groups.values()].map((rows) => {
          const f = rows.at(-1)!;
          const h = d.historyVersions.find(
            (h) => h.version === f.history_version,
          );
          const asset = summary(
            f,
            rows.length,
            expected,
            asOf,
            h ? historyContract(h) : null,
          );
          if (demoMode()) {
            const item = DEMO_UNIVERSE.find((a) => a.id === asset.id);
            asset.artwork = item?.artwork ?? null;
            if (item && isDemoPreview())
              asset.artwork = {
                ...item.artwork,
                url: `/demo-artwork/${item.id}.png`,
              };
            if (item) asset.identity = demoIdentity(item.name, item.category);
          }
          return asset;
        }),
      };
    }
    const snapshotId = process.env.PRODUCT_ANALYTICS_SNAPSHOT_ID;
    if (!snapshotId || !/^[a-f0-9]{64}$/.test(snapshotId))
      return unavailable(
        "A reviewed analytics snapshot has not been configured.",
      );
    const db = connection();
    const head = await db.query(
      "select method,scope,created_at,report from derived_market_snapshots where id=$1",
      [snapshotId],
    );
    if (!head.rows[0] || head.rows[0].method !== METHOD)
      return unavailable(
        "This snapshot lacks the current product reference fields. Regenerate the derived snapshot.",
      );
    const metadata = validateSnapshotHead(head.rows[0]);
    const scope = metadata.scope;
    const [rows, versions] = await Promise.all([
      db.query(
        `select distinct on(asset_id) asset_id,feature,count(*) over(partition by asset_id)::int as available
        from derived_market_features where snapshot_id=$1 order by asset_id,observed_at desc,observation_id desc limit 1001`,
        [snapshotId],
      ),
      db.query(
        "select version,hash,first_seen_at,last_seen_at,left_censored from derived_history_versions where snapshot_id=$1 order by version limit 2017",
        [snapshotId],
      ),
    ]);
    if (rows.rows.length > 1000) throw new Error("READ_LIMIT");
    const hs = new Map<number, MarketHistoryVersion>(
      versions.rows.map((v) => [
        v.version,
        {
          version: v.version,
          hash: v.hash,
          firstSeenAt: new Date(v.first_seen_at).toISOString(),
          lastSeenAt: new Date(v.last_seen_at).toISOString(),
          leftCensored: v.left_censored,
          sourceTimestamp: null,
        },
      ]),
    );
    for (const r of rows.rows) validateFeature(r.feature, scope);
    const assets = rows.rows.map((r) =>
      summary(
        r.feature as Feature,
        r.available,
        (Date.parse(scope.to) - Date.parse(scope.from)) / 300000,
        asOf,
        hs.get(r.feature.history_version) ?? null,
      ),
    );
    const artwork = await catalogPresentation(assets);
    for (const asset of assets) {
      const presentation = artwork.get(asset.id);
      const media = presentation?.media;
      if (presentation) asset.identity = catalogIdentity(presentation);
      asset.artwork =
        media && (media.status === "AVAILABLE" || media.status === "UNVERIFIED")
          ? { ...media, status: media.status }
          : null;
    }
    return {
      snapshotId,
      snapshot: {
        method: metadata.method,
        generatedAt: new Date(metadata.created_at).toISOString(),
        ageSeconds: snapshotAge(scope.to, asOf),
        stale: (snapshotAge(scope.to, asOf) ?? Infinity) > 900,
      },
      evidence: "DATABASE",
      asOf,
      scope,
      error: null,
      assets,
    };
  } catch (e) {
    if (
      e instanceof Error &&
      /SNAPSHOT|SCOPE|METADATA|FEATURE_OUTSIDE/.test(e.message)
    )
      return unavailable(`Snapshot validation failed: ${e.message}.`);
    return unavailable("Analytics data is temporarily unavailable.");
  }
});
export async function readAssetDetail(
  id: string,
  horizon: Horizon | "7d",
): Promise<AssetMarketDetail | null> {
  const dataset = await readMarketDataset(),
    asset = dataset.assets.find((a) => a.id === id);
  if (!asset || !dataset.scope) return null;
  const end = Date.parse(dataset.scope.to),
    span = { "1h": 3600000, "6h": 21600000, "24h": 86400000, "7d": 604800000 }[
      horizon
    ];
  if (!span) throw new Error("UNSUPPORTED_HORIZON");
  const from = new Date(
    Math.max(Date.parse(dataset.scope.from), end - span),
  ).toISOString();
  try {
    let features: Feature[], versions: MarketHistoryVersion[];
    if (syntheticMode()) {
      const d = previewDataset();
      features = d.features.filter(
        (f) =>
          f.asset_id === id &&
          f.observed_at >= from &&
          f.observed_at < dataset.scope!.to,
      );
      const ids = new Set(
        features.flatMap((f) =>
          f.history_version === null ? [] : [f.history_version],
        ),
      );
      versions = d.historyVersions
        .filter((v) => ids.has(v.version))
        .map(historyContract);
    } else {
      const db = connection();
      const result = await db.query(
        "select feature from derived_market_features where snapshot_id=$1 and asset_id=$2::uuid and observed_at >= $3::timestamptz and observed_at < $4::timestamptz order by observed_at,observation_id limit 2017",
        [dataset.snapshotId, id, from, dataset.scope.to],
      );
      features = result.rows.map((r) => r.feature as Feature);
      for (const f of features) {
        validateFeature(f, { ...dataset.scope, assets: [asset.name] });
        if (
          f.asset_id !== id ||
          f.observed_at < from ||
          f.observed_at >= dataset.scope.to
        )
          throw Error("SERIES_OUTSIDE_SCOPE");
      }
      if (features.length > 2016) throw new Error("SERIES_READ_LIMIT");
      const hs = await db.query(
        `select version,hash,first_seen_at,last_seen_at,left_censored from derived_history_versions where snapshot_id=$1 and version=any($2::int[]) order by version`,
        [
          dataset.snapshotId,
          [
            ...new Set(
              features.flatMap((f) =>
                f.history_version === null ? [] : [f.history_version],
              ),
            ),
          ],
        ],
      );
      versions = hs.rows.map((v) => ({
        version: v.version,
        hash: v.hash,
        firstSeenAt: new Date(v.first_seen_at).toISOString(),
        lastSeenAt: new Date(v.last_seen_at).toISOString(),
        leftCensored: v.left_censored,
        sourceTimestamp: null,
      }));
    }
    return {
      asset,
      error: null,
      series: features.map(seriesPoint),
      horizon,
      from,
      to: dataset.scope.to,
      historyVersions: versions,
      evidence: dataset.evidence,
    };
  } catch {
    return {
      asset,
      series: [],
      error: "Observation history is temporarily unavailable.",
      horizon,
      from,
      to: dataset.scope.to,
      historyVersions: [],
      evidence: dataset.evidence,
    };
  }
}
