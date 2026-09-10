// Offline only. Never imported by product routes or client components.
import { STEP, type Feature } from "./model";
import type { SnapshotExport } from "./offline-snapshot";
import { validateExport } from "./offline-snapshot";
import { distribution } from "./report";
export const EXPERIMENT_FROM = "2026-09-09T17:55:00.000Z",
  EXPERIMENT_TO = "2026-09-16T17:55:00.000Z";
const n = (x: unknown) =>
  x === null || x === undefined || x === ""
    ? null
    : Number.isFinite(Number(x))
      ? Number(x)
      : null;
export function researchGate(data: SnapshotExport, now = Date.now()) {
  validateExport(data);
  if (
    data.evidence === "OBSERVED" &&
    (now < Date.parse(EXPERIMENT_TO) ||
      Date.parse(data.head.scope.from) !== Date.parse(EXPERIMENT_FROM) ||
      Date.parse(data.head.scope.to) !== Date.parse(EXPERIMENT_TO))
  )
    throw Error("SEVEN_DAY_EXPERIMENT_NOT_READY");
}
export function rankings(data: SnapshotExport) {
  const groups = Map.groupBy(data.features, (f) => f.asset_id),
    expected =
      (Date.parse(data.head.scope.to) - Date.parse(data.head.scope.from)) /
      STEP;
  const rows = [...groups.entries()].map(([assetId, unsorted]) => {
    const fs = unsorted.toSorted((a, b) =>
        a.scheduled_window.localeCompare(b.scheduled_window),
      ),
      last = fs.at(-1)!;
    let pricePairs = 0,
      priceChanges = 0,
      listingPairs = 0,
      listingChanges = 0;
    for (let i = 1; i < fs.length; i++) {
      if (
        Date.parse(fs[i].scheduled_window) -
          Date.parse(fs[i - 1].scheduled_window) !==
        STEP
      )
        continue;
      const p = n(fs[i].values.min_price),
        q = n(fs[i - 1].values.min_price),
        l = n(fs[i].values.listing_qty),
        k = n(fs[i - 1].values.listing_qty);
      if (p !== null && q !== null) {
        pricePairs++;
        if (p !== q) priceChanges++;
      }
      if (l !== null && k !== null) {
        listingPairs++;
        if (l !== k) listingChanges++;
      }
    }
    const activity = distribution(
      fs
        .filter((f) => f.values.market_activity_pair_count_1h === 12)
        .map((f) => n(f.values.market_activity_score))
        .filter((v): v is number => v !== null),
    );
    const volatility = distribution(
      fs
        .filter((f) => f.values.volatility_return_count_1h === 12)
        .map((f) => n(f.values.realized_volatility_1h))
        .filter((v): v is number => v !== null),
    );
    return {
      assetId,
      name: last.market_hash_name,
      observations: fs.length,
      expected,
      coveragePct: (100 * fs.length) / expected,
      activityMean: activity.mean,
      activitySamples: activity.count,
      volatility1hMean: volatility.mean,
      volatilitySamples: volatility.count,
      priceTransitionPct: pricePairs ? (100 * priceChanges) / pricePairs : null,
      pricePairs,
      priceChanges,
      listingTransitionPct: listingPairs
        ? (100 * listingChanges) / listingPairs
        : null,
      listingPairs,
      listingChanges,
      capturedSourceAgeP95: distribution(
        fs.map((f) => f.items_source_age_seconds),
      ).p95,
    };
  });
  const keys = [
    "activityMean",
    "volatility1hMean",
    "priceTransitionPct",
    "listingTransitionPct",
    "coveragePct",
    "capturedSourceAgeP95",
  ] as const;
  return {
    rows,
    rankings: Object.fromEntries(
      keys.map((key) => [
        key,
        rows
          .toSorted((a, b) =>
            a[key] === null
              ? b[key] === null
                ? a.assetId.localeCompare(b.assetId)
                : 1
              : b[key] === null
                ? -1
                : (a[key]! - b[key]!) *
                    (key === "capturedSourceAgeP95" ? 1 : -1) ||
                  a.assetId.localeCompare(b.assetId),
          )
          .map((r) => r.assetId),
      ]),
    ),
  };
}
export type Pair = {
  assetId: string;
  at: string;
  outcomeAt: string;
  x: number;
  y: number;
};
export type Relationship =
  "listing_to_price" | "activity_to_volatility" | "price_to_listings";
export function leadLagPairs(
  features: Feature[],
  steps: number,
  relationship: Relationship,
) {
  if (![12, 72, 288].includes(steps))
    throw Error("UNSUPPORTED_RESEARCH_HORIZON");
  const pairs: Pair[] = [];
  let missingFuture = 0,
    missingAnchor = 0,
    stale = 0;
  for (const [assetId, fs] of Map.groupBy(features, (f) => f.asset_id)) {
    const byWindow = new Map(
      fs.map((f) => [Date.parse(f.scheduled_window), f]),
    );
    for (const anchor of fs.toSorted((a, b) =>
      a.scheduled_window.localeCompare(b.scheduled_window),
    )) {
      const t = Date.parse(anchor.scheduled_window),
        end = t + steps * STEP;
      // X uses only the published feature at T and (for activity change) T-1h.
      let x = n(
        anchor.values[
          relationship === "listing_to_price"
            ? "listing_qty_pct_change_1h"
            : "min_price_return_1h"
        ],
      );
      if (relationship === "activity_to_volatility") {
        const previous = byWindow.get(t - 12 * STEP),
          a = n(anchor.values.market_activity_score),
          b = n(previous?.values.market_activity_score);
        x =
          anchor.values.market_activity_pair_count_1h === 12 &&
          previous?.values.market_activity_pair_count_1h === 12 &&
          a !== null &&
          b !== null
            ? a - b
            : null;
      }
      if (x === null) {
        missingAnchor++;
        continue;
      }
      const future = Array.from({ length: steps + 1 }, (_, i) =>
        byWindow.get(t + i * STEP),
      );
      if (future.some((f) => !f)) {
        missingFuture++;
        continue;
      }
      const complete = future as Feature[];
      if (
        complete.some(
          (f) =>
            !Number.isFinite(f.items_source_age_seconds) ||
            f.items_source_age_seconds < 0 ||
            f.items_source_age_seconds > 900,
        )
      ) {
        stale++;
        continue;
      }
      const metric =
        relationship === "price_to_listings" ? "listing_qty" : "min_price";
      const values = complete.map((f) => n(f.values[metric]));
      if (values.some((v) => v === null || v < 0) || values[0] === 0) {
        missingFuture++;
        continue;
      }
      let y: number;
      if (relationship === "activity_to_volatility") {
        if (values.some((v) => v === 0)) {
          missingFuture++;
          continue;
        }
        const returns = values
            .slice(1)
            .map((v, i) => Math.log(v! / values[i]!)),
          mean = returns.reduce((s, v) => s + v, 0) / returns.length;
        y =
          Math.sqrt(
            returns.reduce((s, v) => s + (v - mean) ** 2, 0) /
              (returns.length - 1),
          ) * 100;
      } else y = (values.at(-1)! / values[0]! - 1) * 100;
      if (Number.isFinite(y))
        pairs.push({
          assetId,
          at: anchor.observed_at,
          outcomeAt: byWindow.get(end)!.observed_at,
          x,
          y,
        });
    }
  }
  return { pairs, excluded: { missingAnchor, missingFuture, stale } };
}
export function correlation(pairs: Pair[]) {
  if (pairs.length < 3) return null;
  const mx = pairs.reduce((s, p) => s + p.x, 0) / pairs.length,
    my = pairs.reduce((s, p) => s + p.y, 0) / pairs.length;
  let xx = 0,
    yy = 0,
    xy = 0;
  for (const p of pairs) {
    xx += (p.x - mx) ** 2;
    yy += (p.y - my) ** 2;
    xy += (p.x - mx) * (p.y - my);
  }
  return xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : null;
}
export function explore(data: SnapshotExport, steps: number) {
  return (
    ["listing_to_price", "activity_to_volatility", "price_to_listings"] as const
  ).map((relationship) => {
    const { pairs, excluded } = leadLagPairs(
      data.features,
      steps,
      relationship,
    );
    const perAsset = [...Map.groupBy(pairs, (p) => p.assetId)].map(
      ([assetId, ps]) => {
        // Non-overlapping future windows, anchored to the fixed snapshot start.
        const spaced = ps.filter(
          (p) =>
            Math.floor(
              (Date.parse(p.at) - Date.parse(data.head.scope.from)) / STEP,
            ) %
              steps ===
            0,
        );
        return {
          assetId,
          overlappingSamples: ps.length,
          nonOverlappingSamples: spaced.length,
          pearsonOverlapping: correlation(ps),
          pearsonNonOverlapping: correlation(spaced),
        };
      },
    );
    return {
      relationship,
      horizonMinutes: steps * 5,
      anchorHorizonMinutes: 60,
      excluded,
      perAsset,
      note: "Exploratory association only. No causal inference, significance claim, forecast, or product classification. Overlapping samples are dependent; non-overlapping outcomes can still have serial dependence.",
    };
  });
}

export function compareRankings(left: SnapshotExport, right: SnapshotExport) {
  const a = rankings(left),
    b = rankings(right),
    before = new Map(a.rows.map((r) => [r.assetId, r])),
    after = new Map(b.rows.map((r) => [r.assetId, r]));
  const keys = [
    "activityMean",
    "volatility1hMean",
    "priceTransitionPct",
    "listingTransitionPct",
    "coveragePct",
    "capturedSourceAgeP95",
  ] as const;
  return {
    left: { snapshotId: left.snapshotId, scope: left.head.scope },
    right: { snapshotId: right.snapshotId, scope: right.head.scope },
    note: "Differences compare these explicit snapshot scopes; they do not establish market causality.",
    rows: [...new Set([...before.keys(), ...after.keys()])]
      .sort()
      .map((assetId) => {
        const l = before.get(assetId),
          r = after.get(assetId);
        return {
          assetId,
          presentBefore: !!l,
          presentAfter: !!r,
          changes: Object.fromEntries(
            keys.map((k) => [
              k,
              l?.[k] === null ||
              r?.[k] === null ||
              l?.[k] === undefined ||
              r?.[k] === undefined
                ? null
                : r[k]! - l[k]!,
            ]),
          ),
        };
      }),
  };
}
