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
  MarketAssetSummary,
  MarketFreshness,
  SnapshotSelection,
} from "./contract";
import { selectSnapshot } from "../../derived-market/active-snapshot";
import { resolveDerivedDatabase } from "../../derived-market/config";
import { summary, seriesPoint, historyContract } from "./map";
import { FIXTURE_AS_OF, fixtureDataset } from "./fixtures";
import { DEMO_AS_OF, demoDataset } from "./demo";
import { DEMO_UNIVERSE } from "./demo-universe";
import {
  usesBundledDemoArtwork,
  syntheticDataAllowed,
  assertPreviewIsolation,
  syntheticMisconfiguredInProduction,
} from "../../preview";
export { syntheticMisconfiguredInProduction };
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
function connection(url: string) {
  return (pool ??= new Pool({
    connectionString: url,
    max: 3,
    connectionTimeoutMillis: 2000,
    // Both settings travel in `options`, which is a standard libpq startup
    // parameter. node-postgres also accepts a `statement_timeout` field and
    // sends it as its own startup parameter, but Neon's proxy discards that one
    // without complaint — a local Postgres honours it, so the read path appeared
    // to have a five-second ceiling everywhere while production had none.
    options: `-c default_transaction_read_only=on -c statement_timeout=${READ_TIMEOUT_MS}`,
  }));
}
/** Query ceiling for every product read. See DERIVED_READ_SETTINGS. */
export const READ_TIMEOUT_MS = 5000;
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
    freshness: null,
    evidence: "UNAVAILABLE",
    asOf,
    scope: null,
    assets: [],
    error,
  });
  /**
   * The three ages are read off the newest asset evidence rather than off the
   * scope boundary, because a scope can end at a window that produced no
   * observation. Provider age is carried as measured at capture and is never
   * recomputed against the present, which would silently convert "the venue's
   * feed was 40s behind when we read it" into "the venue is now hours behind".
   */
  const freshnessOf = (
    assets: MarketAssetSummary[],
    computedAt: string,
    selection: SnapshotSelection,
    activatedAt: string | null,
  ): MarketFreshness => {
    const newest = assets.reduce<MarketAssetSummary | null>(
      (best, a) =>
        a.quality.observedAt &&
        (!best?.quality.observedAt ||
          a.quality.observedAt > best.quality.observedAt)
          ? a
          : best,
      null,
    );
    const observedAt = newest?.quality.observedAt ?? null;
    const since = (from: string | null) => {
      if (!from) return null;
      const seconds = (Date.parse(asOf) - Date.parse(from)) / 1000;
      return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
    };
    return {
      marketEvidence: { observedAt, ageSeconds: since(observedAt) },
      providerEvidence: {
        ageAtCaptureSeconds: newest?.quality.capturedSourceAgeSeconds ?? null,
        capturedAt: observedAt,
      },
      intelligence: {
        computedAt,
        ageSeconds: since(computedAt),
        activatedAt,
        selection,
      },
    };
  };
  if (syntheticMisconfiguredInProduction()) {
    console.error(
      JSON.stringify({
        event: "analytics.synthetic_blocked_in_production",
        mode: process.env.PRODUCT_ANALYTICS_MODE,
      }),
    );
    return unavailable(
      `Synthetic analytics mode "${process.env.PRODUCT_ANALYTICS_MODE}" is configured but is not permitted here. Real observations are not being shown, and synthetic data will not be substituted.`,
    );
  }
  try {
    if (syntheticMode()) {
      const d = previewDataset(),
        groups = Map.groupBy(d.features, (f) => f.asset_id),
        expected = (Date.parse(d.scope.to) - Date.parse(d.scope.from)) / 300000;
      const assets = [...groups.values()].map((rows) => {
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
          if (item && usesBundledDemoArtwork())
            asset.artwork = {
              ...item.artwork,
              url: `/demo-artwork/${item.id}.png`,
            };
          if (item) asset.identity = demoIdentity(item.name, item.category);
        }
        return asset;
      });
      return {
        snapshotId: d.snapshotId,
        snapshot: {
          method: METHOD,
          generatedAt: asOf,
          ageSeconds: 0,
          stale: false,
          selection: "SYNTHETIC",
          activatedAt: null,
        },
        freshness: freshnessOf(assets, asOf, "SYNTHETIC", null),
        evidence: "SYNTHETIC",
        preview: demoMode() ? "DEMO" : "QA",
        asOf,
        scope: d.scope,
        error: null,
        assets,
      };
    }
    // Fail closed on an absent or ambiguous derived database. There is no
    // fallback to the market database: serving it would look like success while
    // showing something that was never a reviewed snapshot.
    const derived = resolveDerivedDatabase();
    if (!derived.ok) {
      console.error(
        JSON.stringify({
          event: "analytics.derived_database_unusable",
          code: derived.code,
        }),
      );
      return unavailable(
        derived.code === "ABSENT"
          ? "A reviewed analytics snapshot has not been configured."
          : "The analytics database is misconfigured. Real observations are not being shown, and nothing is being substituted.",
      );
    }
    const db = connection(derived.url);
    // Resolution order: explicit override, then the active pointer, then
    // UNAVAILABLE. The pointer is what a refresh moves, so a new snapshot
    // reaches readers without a redeploy; the override outranks it so a
    // specific snapshot can be pinned or a bad activation bypassed.
    const selection = await selectSnapshot(
      db,
      process.env.PRODUCT_ANALYTICS_SNAPSHOT_ID,
    );
    if (selection.snapshotId === null) return unavailable(selection.reason);
    const snapshotId = selection.snapshotId;
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
    // Availability is recorded per asset in the reviewed snapshot report.
    const availability = (
      metadata.report as {
        availability?: Record<
          string,
          { state?: string; basis?: string; lastActiveAt?: string | null }
        >;
      }
    ).availability;
    for (const asset of assets) {
      const entry = availability?.[asset.name];
      if (
        entry?.state === "ACTIVE" ||
        entry?.state === "NO_ACTIVE_LISTING_OBSERVED" ||
        entry?.state === "PROVIDER_OR_COVERAGE_UNKNOWN"
      ) {
        asset.availability = entry.state;
        asset.availabilityDetail = entry.basis ?? null;
        asset.availabilityObservedAt = entry.lastActiveAt ?? null;
      }
    }
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
    const computedAt = new Date(metadata.created_at).toISOString();
    return {
      snapshotId,
      snapshot: {
        method: metadata.method,
        generatedAt: computedAt,
        ageSeconds: snapshotAge(scope.to, asOf),
        stale: (snapshotAge(scope.to, asOf) ?? Infinity) > 900,
        selection: selection.source,
        activatedAt:
          selection.source === "ACTIVE_POINTER" ? selection.activatedAt : null,
      },
      freshness: freshnessOf(
        assets,
        computedAt,
        selection.source,
        selection.source === "ACTIVE_POINTER" ? selection.activatedAt : null,
      ),
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
      // The dataset only resolved because the config was usable, but check
      // again rather than assume: this path is also reachable directly.
      const derived = resolveDerivedDatabase();
      if (!derived.ok) throw new Error("ANALYTICS_NOT_CONFIGURED");
      const db = connection(derived.url);
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
