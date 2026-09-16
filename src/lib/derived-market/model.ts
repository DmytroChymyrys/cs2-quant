// v3: the snapshot digest hashes a per-observation content digest (including a
// History payload hash) instead of inlining every payload, so identical input still
// yields an identical ID while derivation can run one asset at a time.
export const METHOD = "listing-features-v3";
export const STEP = 300_000;
// Product-facing derivations stay at seven days. A longer scope must be requested
// explicitly and can never exceed MAX_SCOPE_DAYS; scope is never unbounded.
export const DEFAULT_SCOPE_DAYS = 7;
export const MAX_SCOPE_DAYS = 35;
export const TOLERANCE = 90_000;
export type Scope = { from: string; to: string; assets: string[] };
export type Run = {
  id: string;
  source: "SKINPORT";
  window: string;
  startedAt: string;
  status: string;
  claimed: boolean;
  durationMs: number | null;
  itemsStatus: number | null;
  historyStatus: number | null;
  errorCode: string | null;
  upstreamErrors: string[];
  historyHash: string | null;
  historyFetchedAt: string | null;
};
export type RawObservation = {
  id: string;
  runId: string;
  assetId: string;
  name: string;
  observedAt: string;
  itemsSourceAt: string;
  minPrice: string | null;
  medianPrice: string | null;
  quantity: number;
  // Only used to populate the versioned dimension, NEVER copied into feature rows.
  history: Record<string, unknown> | null;
};
export type Input = {
  scope: Scope;
  runs: Run[];
  observations: RawObservation[];
};
export type HistoryVersion = {
  version: number;
  source: "SKINPORT";
  hash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  firstWindow: string;
  fetchCount: number;
  sourceTimestamp: null;
  leftCensored: boolean;
};
export type HistoryValue = {
  version: number;
  assetId: string;
  payload: Record<string, unknown>;
};
export type Feature = {
  observation_id: string;
  asset_id: string;
  market_hash_name: string;
  collector_run_id: string;
  scheduled_window: string;
  observed_at: string;
  items_source_timestamp: string;
  items_source_age_seconds: number;
  history_hash: string | null;
  history_version: number | null;
  history_changed: boolean | null;
  history_age_seconds: number | null;
  history_age_is_lower_bound: true;
  // Decimal strings for arithmetic; NULL means insufficient/invalid history, never invented zero.
  values: Record<string, string | number | null>;
};
export function validateScope(
  scope: Scope,
  maxDays: number = DEFAULT_SCOPE_DAYS,
) {
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > MAX_SCOPE_DAYS)
    throw new Error(
      `SCOPE_DAYS_MUST_BE_AN_INTEGER_BETWEEN_1_AND_${MAX_SCOPE_DAYS}`,
    );
  const from = Date.parse(scope.from),
    to = Date.parse(scope.to);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from % STEP ||
    to % STEP ||
    to <= from ||
    to - from > maxDays * 86400000
  )
    throw new Error(
      `SCOPE_MUST_BE_ALIGNED_POSITIVE_AND_AT_MOST_${maxDays}_DAYS`,
    );
  if (
    !scope.assets.length ||
    scope.assets.length > 1000 ||
    new Set(scope.assets).size !== scope.assets.length
  )
    throw new Error("EXPLICIT_UNIQUE_ASSET_UNIVERSE_REQUIRED_MAX_1000");
  return { from, to };
}
