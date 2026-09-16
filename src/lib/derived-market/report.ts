import Decimal from "decimal.js";
import { type Input, STEP, validateScope, DEFAULT_SCOPE_DAYS } from "./model";
import { prepare } from "./prepare";
import { derive, type Derived } from "./features";
export function distribution(values: number[]) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const p = (q: number) => {
    if (!s.length) return null;
    const i = (s.length - 1) * q,
      l = Math.floor(i);
    return s[l] + (s[Math.ceil(i)] - s[l]) * (i - l);
  };
  return {
    count: s.length,
    min: s[0] ?? null,
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null,
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    max: s.at(-1) ?? null,
  };
}
const summary = (values: (string | number | null)[]) => {
  const s = values
    .filter((x): x is string | number => x !== null)
    .map((x) => new Decimal(x));
  return {
    count: s.length,
    min: s.length ? Decimal.min(...s).toFixed(8) : null,
    max: s.length ? Decimal.max(...s).toFixed(8) : null,
    mean: s.length
      ? s
          .reduce((sum, x) => sum.plus(x), new Decimal(0))
          .div(s.length)
          .toFixed(8)
      : null,
  };
};
export function makeReport(
  input: Input,
  derived?: Derived,
  maxDays: number = DEFAULT_SCOPE_DAYS,
) {
  derived ??= derive(input, maxDays);
  const { from, to } = validateScope(input.scope, maxDays),
    data = prepare(input);
  const expectedWindows = (to - from) / STEP,
    claimedGroups = Map.groupBy(data.claimed, (r) => r.window);
  const windows = Array.from({ length: expectedWindows }, (_, i) =>
    new Date(from + i * STEP).toISOString(),
  );
  const observedGroups = Map.groupBy(
    data.valid,
    (o) => data.runMap.get(o.runId)!.window,
  );
  const perWindow = windows.map((window) => ({
    window,
    claimedRuns: claimedGroups.get(window)?.length ?? 0,
    assetsObserved: new Set(
      (observedGroups.get(window) ?? []).map((o) => o.assetId),
    ).size,
    expectedAssets: input.scope.assets.length,
  }));
  const missing = windows.filter((w) => !claimedGroups.has(w));
  const statuses = Object.fromEntries(
    ["SUCCESS", "PARTIAL", "FAILED", "RUNNING"].map((s) => [
      s,
      data.claimed.filter((r) => r.status === s).length,
    ]),
  );
  const errors: Record<string, number> = {};
  for (const r of data.claimed)
    for (const e of [
      ...(r.errorCode ? [r.errorCode] : []),
      ...r.upstreamErrors,
    ])
      errors[e] = (errors[e] ?? 0) + 1;
  const httpErrors = data.claimed.filter(
    (r) => (r.itemsStatus ?? 0) >= 400 || (r.historyStatus ?? 0) >= 400,
  ).length;
  const malformed = data.claimed.filter((r) =>
    [r.errorCode, ...r.upstreamErrors].some(
      (e) => e === "MALFORMED_JSON" || e === "INVALID_SCHEMA",
    ),
  ).length;
  const freshness = derived.features.map((f) => f.items_source_age_seconds);
  const failures: string[] = [];
  if (data.invalidObservationIds.length)
    failures.push("OBSERVATION_TIMESTAMP_OUTSIDE_SCHEDULED_BUCKET");
  if (missing.length) failures.push("MISSING_SCHEDULED_WINDOWS");
  if (statuses.FAILED || statuses.PARTIAL || statuses.RUNNING)
    failures.push("NON_SUCCESS_CLAIMED_RUNS");
  if (data.duplicateWindows.length || data.duplicatePairs.length)
    failures.push("DUPLICATE_INTEGRITY");
  if (perWindow.some((w) => w.assetsObserved !== w.expectedAssets))
    failures.push("ASSET_COVERAGE");
  if (data.raw.some((o) => !data.runMap.get(o.runId)!.claimed))
    failures.push("OBSERVATIONS_FROM_UNCLAIMED_RUN");
  if (httpErrors || malformed) failures.push("PROVIDER_ERRORS");
  if (freshness.some((x) => !Number.isFinite(x) || x < 0 || x > 900))
    failures.push("ITEMS_FRESHNESS_OUTSIDE_0_900_SECONDS");
  if (
    data.claimed.some(
      (r) => r.durationMs === null || r.durationMs < 0 || r.durationMs >= STEP,
    )
  )
    failures.push("INVALID_OR_OVERRUN_DURATION");
  const byAsset = Map.groupBy(data.valid, (o) => o.name),
    featuresByAsset = Map.groupBy(derived.features, (o) => o.market_hash_name);
  const activity = input.scope.assets.map((name) => {
    const rows = byAsset.get(name) ?? [],
      features = featuresByAsset.get(name) ?? [];
    let comparisons = 0,
      minChanges = 0,
      medianChanges = 0,
      validPriceComparisons = 0,
      completeMarketComparisons = 0,
      listingChanges = 0,
      unchanged = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1],
        b = rows[i];
      if (
        Date.parse(data.runMap.get(b.runId)!.window) -
          Date.parse(data.runMap.get(a.runId)!.window) !==
        STEP
      )
        continue;
      comparisons++;
      const validMin = a.minPrice !== null && b.minPrice !== null;
      const validMedian = a.medianPrice !== null && b.medianPrice !== null;
      validPriceComparisons += Number(validMin);
      completeMarketComparisons += Number(validMin && validMedian);
      const m = validMin && !new Decimal(a.minPrice!).eq(b.minPrice!),
        d = validMedian && !new Decimal(a.medianPrice!).eq(b.medianPrice!),
        q = a.quantity !== b.quantity;
      minChanges += Number(m);
      medianChanges += Number(d);
      listingChanges += Number(q);
      unchanged += Number(validMin && validMedian && !m && !d && !q);
    }
    const last = features.at(-1);
    return {
      asset: name,
      observations: rows.length,
      expected: expectedWindows,
      missing: Math.max(0, expectedWindows - rows.length),
      comparisons,
      validPriceComparisons,
      completeMarketComparisons,
      minPriceChanges: minChanges,
      medianPriceChanges: medianChanges,
      listingCountChanges: listingChanges,
      minPriceChangeFrequency: validPriceComparisons
        ? minChanges / validPriceComparisons
        : null,
      listingChangeFrequency: comparisons ? listingChanges / comparisons : null,
      unchangedObservationPercent: completeMarketComparisons
        ? (unchanged / completeMarketComparisons) * 100
        : null,
      minListingPrice: summary(rows.map((o) => o.minPrice)),
      medianListingPrice: summary(rows.map((o) => o.medianPrice)),
      listingQuantity: summary(rows.map((o) => o.quantity)),
      latestMarketActivityScore: last?.values.market_activity_score ?? null,
      latestRealizedVolatility24h: last?.values.realized_volatility_24h ?? null,
    };
  });
  const daily = [];
  for (let t = from; t < to;) {
    const end = Math.min(to, Math.floor(t / 86400000) * 86400000 + 86400000);
    const runs = data.claimed.filter(
      (r) => Date.parse(r.window) >= t && Date.parse(r.window) < end,
    );
    const fs = derived.features.filter(
      (f) =>
        Date.parse(f.scheduled_window) >= t &&
        Date.parse(f.scheduled_window) < end,
    );
    daily.push({
      from: new Date(t).toISOString(),
      to: new Date(end).toISOString(),
      expectedWindows: (end - t) / STEP,
      successfulWindows: runs.filter((r) => r.status === "SUCCESS").length,
      durationMs: distribution(
        runs.flatMap((r) => (r.durationMs === null ? [] : [r.durationMs])),
      ),
      sourceAgeSeconds: distribution(fs.map((f) => f.items_source_age_seconds)),
    });
    t = end;
  }
  const changes = derived.historyVersions.slice(1).map((v) => ({
    scheduledWindow: v.firstWindow,
    observedAt: v.firstSeenAt,
    hash: v.hash,
  }));
  const ranking = (
    key:
      | "latestMarketActivityScore"
      | "minPriceChangeFrequency"
      | "listingChangeFrequency"
      | "latestRealizedVolatility24h",
  ) =>
    activity
      .filter((a) => a[key] !== null)
      .sort(
        (a, b) =>
          Number(b[key]) - Number(a[key]) || a.asset.localeCompare(b.asset),
      )
      .map((a) => ({ asset: a.asset, value: a[key] }));
  return {
    method: derived.method,
    scope: derived.scope,
    snapshotId: derived.snapshotId,
    operationalStatus: failures.length ? "FAIL" : "PASS",
    operationalFailures: failures,
    reliability: {
      expectedWindows,
      actualClaimedWindows: claimedGroups.size,
      statusCounts: statuses,
      successRate: statuses.SUCCESS / expectedWindows,
      missingWindows: missing,
      duplicateClaimedWindows: data.duplicateWindows,
      duplicateRunAssetPairs: data.duplicatePairs,
      invalidObservationIds: data.invalidObservationIds,
      suppressedDuplicateAttempts: data.runs.filter(
        (r) => !r.claimed && r.errorCode === "DUPLICATE_WINDOW",
      ).length,
      failuresByType: errors,
      httpErrorRuns: httpErrors,
      malformedPayloadRuns: malformed,
      perWindow,
    },
    performance: {
      durationMs: distribution(
        data.claimed.flatMap((r) =>
          r.durationMs === null ? [] : [r.durationMs],
        ),
      ),
    },
    freshness: {
      itemsSourceAgeSeconds: distribution(freshness),
      outliers: derived.features
        .filter(
          (f) =>
            f.items_source_age_seconds < 0 || f.items_source_age_seconds > 900,
        )
        .map((f) => ({
          observationId: f.observation_id,
          ageSeconds: f.items_source_age_seconds,
        })),
    },
    daily,
    historyCadence: {
      scope:
        "Complete response byte hashes, including untracked rows; changes are observed, not authoritative publication times.",
      hashedFetches: derived.historyVersions.reduce(
        (s, v) => s + v.fetchCount,
        0,
      ),
      missingHashRuns: data.claimed.filter((r) => !r.historyHash).length,
      distinctHashes: new Set(derived.historyVersions.map((v) => v.hash)).size,
      observedVersions: derived.historyVersions.length,
      changes,
      intervalsBetweenObservedChangesSeconds: changes
        .slice(1)
        .map(
          (c, i) =>
            (Date.parse(c.observedAt) - Date.parse(changes[i].observedAt)) /
            1000,
        ),
      longestIdenticalFetchedSequence: Math.max(
        0,
        ...derived.historyVersions.map((v) => v.fetchCount),
      ),
      versions: derived.historyVersions,
    },
    activity,
    unchangedAssets: activity
      .filter((a) => a.comparisons > 0 && a.unchangedObservationPercent === 100)
      .map((a) => a.asset),
    rankings: {
      observedActivity: ranking("latestMarketActivityScore"),
      priceChangeFrequency: ranking("minPriceChangeFrequency"),
      listingChangeFrequency: ranking("listingChangeFrequency"),
      realizedVolatility: ranking("latestRealizedVolatility24h"),
    },
    limitations: [
      "Descriptive listing statistics, not trading signals or liquidity estimates.",
      "History values live once per version/asset and are absent from five-minute features.",
      "All features use only observations inside the requested scope; left-edge horizons are NULL until enough data exists.",
      "Unchanged snapshots are valid. Rankings use latest complete rolling values for activity/volatility, whole-window frequencies for transitions.",
    ],
  };
}
