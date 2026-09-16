import Decimal from "decimal.js";
import {
  type Input,
  type Feature,
  type HistoryVersion,
  type HistoryValue,
  METHOD,
  STEP,
  TOLERANCE,
  DEFAULT_SCOPE_DAYS,
} from "./model";
import {
  prepare,
  digest,
  observationDigest,
  snapshotIdentity,
} from "./prepare";
const D = Decimal.clone({ precision: 40 });
const format = (v: Decimal) => v.toFixed(12);
export function change(
  current: string | number | null,
  previous: string | number | null,
) {
  if (current === null || previous === null) return { abs: null, pct: null };
  const a = new D(current),
    b = new D(previous);
  return {
    abs: format(a.minus(b)),
    pct: b.isZero() ? null : format(a.minus(b).div(b).times(100)),
  };
}
export function derive(input: Input, maxDays: number = DEFAULT_SCOPE_DAYS) {
  const data = prepare(input, maxDays);
  const { historyVersions, historyByRun } = buildHistoryVersions(
    data.claimed,
    data.duplicateWindows,
  );
  const historyValues: HistoryValue[] = [];
  const dimensions = new Map<string, string>();
  const features: Feature[] = [];
  const ctx: AssetContext = {
    runMap: data.runMap,
    historyByRun,
    dimensions,
    historyValues,
  };
  for (const assetRows of Map.groupBy(data.valid, (o) => o.assetId).values())
    features.push(...assetFeatures(assetRows, ctx));
  const scope = { ...input.scope, assets: [...input.scope.assets].sort() };
  const snapshotId = snapshotIdentity(
    scope,
    data.runs,
    data.raw.map(observationDigest),
  );
  return {
    snapshotId,
    method: METHOD,
    scope,
    features,
    historyVersions,
    historyValues,
    excludedDuplicateWindows: data.duplicateWindows,
    excludedDuplicatePairs: data.duplicatePairs,
  };
}
export type Derived = ReturnType<typeof derive>;
export type HistoryBinding = {
  version: HistoryVersion;
  changed: boolean | null;
};
export type AssetContext = {
  runMap: Map<string, Input["runs"][number]>;
  historyByRun: Map<string, HistoryBinding>;
  // Shared across assets so one payload is retained per (version, asset).
  dimensions: Map<string, string>;
  historyValues: HistoryValue[];
};
// One asset's complete feature series. Every horizon baseline is internal to this
// asset, so assets can be derived independently and streamed one at a time.
export function assetFeatures(
  assetRows: Input["observations"],
  ctx: AssetContext,
): Feature[] {
  const { runMap, historyByRun, dimensions, historyValues } = ctx;
  const features: Feature[] = [];

  const rows = assetRows.map((o) => ({
    ...o,
    time: Date.parse(o.observedAt),
    window: Date.parse(runMap.get(o.runId)!.window),
  }));
  const logReturns: (number | null)[] = [],
    medianLogReturns: (number | null)[] = [],
    priceTransitions: number[] = [],
    qtyTransitions: number[] = [],
    validPairs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i],
      prev = rows[i - 1];
    const adjacent =
      prev &&
      row.window - prev.window === STEP &&
      row.time > prev.time &&
      Math.abs(row.time - prev.time - STEP) <= TOLERANCE;
    const pair = !!adjacent && row.minPrice !== null && prev.minPrice !== null;
    validPairs.push(pair ? 1 : 0);
    priceTransitions.push(
      pair && !new D(row.minPrice!).eq(prev.minPrice!) ? 1 : 0,
    );
    qtyTransitions.push(pair && row.quantity !== prev.quantity ? 1 : 0);
    logReturns.push(
      pair && new D(row.minPrice!).gt(0) && new D(prev.minPrice!).gt(0)
        ? Math.log(new D(row.minPrice!).div(prev.minPrice!).toNumber())
        : null,
    );
    // Median-basis returns are the production volatility basis: unlike the
    // cheapest listing, the middle of the book does not jump on a single fill.
    const medianPair =
      !!adjacent && row.medianPrice !== null && prev.medianPrice !== null;
    medianLogReturns.push(
      medianPair &&
        new D(row.medianPrice!).gt(0) &&
        new D(prev.medianPrice!).gt(0)
        ? Math.log(new D(row.medianPrice!).div(prev.medianPrice!).toNumber())
        : null,
    );
    // Historical endpoints are prior observations within +/-90s of the target time.
    // The tolerance is less than half a cadence, so a missing bucket cannot bridge a 5m return.
    const nearest = (
      horizon: number,
      field: "minPrice" | "medianPrice" | "quantity",
    ) => {
      const target = row.time - horizon;
      let lo = 0,
        hi = i;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (rows[mid].time < target - TOLERANCE) lo = mid + 1;
        else hi = mid;
      }
      let best: typeof row | undefined;
      for (let j = lo; j < i && rows[j].time <= target + TOLERANCE; j++) {
        if (rows[j][field] === null || rows[j].time >= row.time) continue;
        if (
          !best ||
          Math.abs(rows[j].time - target) < Math.abs(best.time - target)
        )
          best = rows[j];
      }
      return best;
    };
    const values: Feature["values"] = {
      min_price: row.minPrice,
      median_price: row.medianPrice,
      listing_qty: row.quantity,
    };
    for (const [field, label] of [
      ["minPrice", "min_price"],
      ["medianPrice", "median_price"],
    ] as const) {
      const baseline = nearest(STEP, field);
      const c = change(row[field], baseline?.[field] ?? null);
      values[`${label}_change_abs_5m`] = c.abs;
      values[`${label}_change_pct_5m`] = c.pct;
      values[`${label}_baseline_observation_id_5m`] = baseline?.id ?? null;
      for (const [name, h] of [
        ["15m", 3],
        ["1h", 12],
        ["6h", 72],
        ["24h", 288],
      ] as const) {
        const past = nearest(h * STEP, field);
        values[`${label}_return_${name}`] = change(
          row[field],
          past?.[field] ?? null,
        ).pct;
        values[`${label}_baseline_observation_id_${name}`] = past?.id ?? null;
      }
    }
    for (const [name, h] of [
      ["5m", 1],
      ["1h", 12],
      ["6h", 72],
      ["24h", 288],
    ] as const) {
      const past = nearest(h * STEP, "quantity"),
        c = change(row.quantity, past?.quantity ?? null);
      values[`listing_qty_delta_${name}`] = c.abs;
      values[`listing_qty_pct_change_${name}`] = c.pct;
    }
    for (const [name, steps] of [
      ["1h", 12],
      ["6h", 72],
      ["24h", 288],
    ] as const) {
      let begin = i;
      while (begin > 0 && rows[begin - 1].window > row.window - steps * STEP)
        begin--;
      const active = rows.slice(begin, i + 1);
      values[`listing_qty_rolling_min_${name}`] = Math.min(
        ...active.map((r) => r.quantity),
      );
      values[`listing_qty_rolling_max_${name}`] = Math.max(
        ...active.map((r) => r.quantity),
      );
      values[`listing_qty_rolling_avg_${name}`] = format(
        active
          .reduce((sum, r) => sum.plus(r.quantity), new D(0))
          .div(active.length),
      );
      values[`rolling_observation_count_${name}`] = active.length;
      values[`rolling_expected_count_${name}`] = steps;
      const stdevPct = (sample: number[]) => {
        if (sample.length !== steps) return null;
        const mean = sample.reduce((s, x) => s + x, 0) / sample.length;
        return (
          Math.sqrt(
            sample.reduce((sum, x) => sum + (x - mean) ** 2, 0) /
              (sample.length - 1),
          ) * 100
        ).toFixed(12);
      };
      const returns = logReturns
        .slice(begin, i + 1)
        .filter((x): x is number => x !== null);
      const medianReturns = medianLogReturns
        .slice(begin, i + 1)
        .filter((x): x is number => x !== null);
      values[`volatility_return_count_${name}`] = returns.length;
      values[`median_volatility_return_count_${name}`] = medianReturns.length;
      // Full coverage only, no gap interpolation; zero returns remain in the sample.
      values[`realized_volatility_${name}`] = stdevPct(returns);
      values[`median_realized_volatility_${name}`] = stdevPct(medianReturns);
      // Activity is also produced at 24h: over one hour 71% of observed values
      // are exactly zero, so the 24h window is the better-behaved basis for a
      // "quiet market" threshold.
      if (name === "1h" || name === "24h") {
        const pairs = validPairs.slice(begin, i + 1).reduce((s, x) => s + x, 0);
        const suffix = name === "1h" ? "" : "_24h";
        values[`market_activity_pair_count_${name}`] = pairs;
        values[`market_activity_score${suffix}`] =
          pairs === steps
            ? format(
                new D(
                  priceTransitions
                    .slice(begin, i + 1)
                    .reduce((s, x) => s + x, 0) +
                    qtyTransitions
                      .slice(begin, i + 1)
                      .reduce((s, x) => s + x, 0),
                )
                  .div(2 * pairs)
                  .times(100),
              )
            : null;
      }
    }
    const h = historyByRun.get(row.runId);
    if (h && row.history) {
      const key = `${h.version.version}:${row.assetId}`,
        hash = digest(row.history);
      if (dimensions.has(key) && dimensions.get(key) !== hash)
        throw new Error("HISTORY_PAYLOAD_CONFLICT_WITHIN_VERSION");
      if (!dimensions.has(key)) {
        dimensions.set(key, hash);
        historyValues.push({
          version: h.version.version,
          assetId: row.assetId,
          payload: row.history,
        });
      }
    }
    features.push({
      observation_id: row.id,
      asset_id: row.assetId,
      market_hash_name: row.name,
      collector_run_id: row.runId,
      scheduled_window: runMap.get(row.runId)!.window,
      observed_at: row.observedAt,
      items_source_timestamp: row.itemsSourceAt,
      items_source_age_seconds:
        (row.time - Date.parse(row.itemsSourceAt)) / 1000,
      history_hash: h?.version.hash ?? null,
      history_version: h?.version.version ?? null,
      history_changed: h?.changed ?? null,
      history_age_seconds: h
        ? Math.max(0, (row.time - Date.parse(h.version.firstSeenAt)) / 1000)
        : null,
      history_age_is_lower_bound: true,
      values,
    });
  }

  return features;
}
// Observed History hash episodes are run-level, so they are built once for all assets.
export function buildHistoryVersions(
  claimed: Input["runs"],
  duplicateWindows: string[],
) {
  const historyVersions: HistoryVersion[] = [];
  const historyByRun = new Map<string, HistoryBinding>();
  let previousHash: string | null = null;
  for (const run of claimed) {
    if (duplicateWindows.includes(run.window)) continue;
    if (!run.historyHash || !run.historyFetchedAt) continue;
    let version = historyVersions.at(-1);
    const changed =
      previousHash === null ? null : run.historyHash !== previousHash;
    if (!version || changed) {
      version = {
        version: historyVersions.length + 1,
        source: "SKINPORT",
        hash: run.historyHash,
        firstSeenAt: run.historyFetchedAt,
        lastSeenAt: run.historyFetchedAt,
        firstWindow: run.window,
        fetchCount: 0,
        sourceTimestamp: null,
        leftCensored: previousHash === null,
      };
      historyVersions.push(version);
    }
    version.fetchCount++;
    version.lastSeenAt = run.historyFetchedAt;
    historyByRun.set(run.id, { version, changed });
    previousHash = run.historyHash;
  }
  return { historyVersions, historyByRun };
}
