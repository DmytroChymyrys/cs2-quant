import {
  METHOD,
  STEP,
  validateScope,
  MAX_SCOPE_DAYS,
  type Scope,
  type Feature,
} from "./model";
import { distribution } from "./report";
export type SnapshotHead = {
  method: string;
  scope: Scope;
  created_at: string | Date;
  report: Record<string, unknown>;
};
// A stored snapshot may legitimately cover a longer research scope than the
// default product horizon, so reading validates against the hard maximum.
export function validateSnapshotHead(value: unknown): SnapshotHead {
  if (!value || typeof value !== "object") throw Error("SNAPSHOT_NOT_FOUND");
  const h = value as SnapshotHead;
  if (h.method !== METHOD) throw Error("UNSUPPORTED_SNAPSHOT_METHOD");
  if (
    !h.scope ||
    !Array.isArray(h.scope.assets) ||
    !h.scope.assets.length ||
    h.scope.assets.some((a) => typeof a !== "string" || !a.trim()) ||
    new Set(h.scope.assets).size !== h.scope.assets.length
  )
    throw Error("INCOMPLETE_SNAPSHOT_METADATA");
  validateScope(h.scope, MAX_SCOPE_DAYS);
  if (
    !Number.isFinite(new Date(h.created_at).getTime()) ||
    !h.report ||
    typeof h.report !== "object" ||
    Array.isArray(h.report)
  )
    throw Error("INCOMPLETE_SNAPSHOT_METADATA");
  return h;
}
export function snapshotAge(to: string, asOf: string) {
  const age = (Date.parse(asOf) - Date.parse(to)) / 1000;
  return Number.isFinite(age) && age >= 0 ? age : null;
}
export function validateFeature(f: Feature, scope: Scope) {
  if (
    !f ||
    !f.asset_id ||
    !f.observation_id ||
    !scope.assets.includes(f.market_hash_name) ||
    !f.values ||
    !["min_price", "median_price", "listing_qty"].every((k) =>
      Object.hasOwn(f.values, k),
    )
  )
    throw Error("INCOMPLETE_FEATURE_METADATA");
  const t = Date.parse(f.observed_at),
    w = Date.parse(f.scheduled_window),
    source = Date.parse(f.items_source_timestamp);
  if (
    !Number.isFinite(t) ||
    !Number.isFinite(w) ||
    !Number.isFinite(source) ||
    w % STEP ||
    t < w ||
    t >= w + STEP ||
    t < Date.parse(scope.from) ||
    t >= Date.parse(scope.to) ||
    w < Date.parse(scope.from)
  )
    throw Error("FEATURE_OUTSIDE_SCOPE");
}
export function reviewSnapshot(
  head: SnapshotHead,
  features: Feature[],
  historyVersions: number,
  asOf: string,
) {
  validateSnapshotHead(head);
  if (!features.length || features.length > 250000)
    throw Error("FEATURE_READ_LIMIT");
  const pairs = new Set<string>();
  for (const f of features) {
    validateFeature(f, head.scope);
    const key = f.asset_id + ":" + f.scheduled_window;
    if (pairs.has(key)) throw Error("DUPLICATE_FEATURE_WINDOW");
    pairs.add(key);
  }
  const grouped = Map.groupBy(features, (f) => f.asset_id),
    expectedPerAsset =
      (Date.parse(head.scope.to) - Date.parse(head.scope.from)) / STEP;
  const latest = [...grouped.values()].map((rows) =>
    rows.toSorted((a, b) => a.observed_at.localeCompare(b.observed_at)).at(-1)!,
  );
  return {
    method: head.method,
    scope: head.scope,
    generatedAt: new Date(head.created_at).toISOString(),
    reviewedAt: asOf,
    snapshotAgeSeconds: snapshotAge(head.scope.to, asOf),
    assetsObserved: grouped.size,
    assetsExpected: head.scope.assets.length,
    observations: features.length,
    expectedObservations: expectedPerAsset * head.scope.assets.length,
    coveragePct:
      (100 * features.length) / (expectedPerAsset * head.scope.assets.length),
    historyVersions,
    sourceAgeNowSeconds: distribution(
      latest.map(
        (f) => (Date.parse(asOf) - Date.parse(f.items_source_timestamp)) / 1000,
      ),
    ),
    observationAgeNowSeconds: distribution(
      latest.map((f) => (Date.parse(asOf) - Date.parse(f.observed_at)) / 1000),
    ),
    capturedSourceAgeSeconds: distribution(
      features.map((f) => f.items_source_age_seconds),
    ),
    warnings: [
      ...(grouped.size < head.scope.assets.length ? ["MISSING_ASSETS"] : []),
      ...(features.length < expectedPerAsset * head.scope.assets.length
        ? ["PARTIAL_COVERAGE"]
        : []),
      ...((snapshotAge(head.scope.to, asOf) ?? Infinity) > 900
        ? ["STALE_SNAPSHOT"]
        : []),
    ],
  };
}
