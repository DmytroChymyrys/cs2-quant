import { createHash } from "node:crypto";
import { type Input, type Scope, METHOD, STEP } from "./model";
import { prepare, observationDigest, snapshotIdentity } from "./prepare";
import type { Queryable } from "./active-snapshot";

/**
 * Decides whether a persisted snapshot may become the active one.
 *
 * The distinction this module draws is between evidence that is INCOMPLETE and
 * evidence that is WRONG. A snapshot describing a market that had provider
 * outages, missing collection windows and partially covered assets is an honest
 * description of a degraded week — the product already renders those states
 * truthfully, and refusing to publish it would freeze the product on older data
 * that is no less degraded and merely staler. A snapshot whose contents
 * contradict themselves, cannot be read back, or is not the snapshot we believe
 * we computed, is not publishable at any level of degradation.
 *
 * So operationalStatus === "FAIL" is deliberately NOT a gate. Each individual
 * operational failure is classified below on its own merits.
 */
export type Finding = { code: string; detail: string };

export type ValidationResult = {
  snapshotId: string;
  publishable: boolean;
  blocking: Finding[];
  advisory: Finding[];
  readBack: {
    method: string;
    scope: Scope;
    createdAt: string;
    features: number;
    historyVersions: number;
    historyValues: number;
    assets: number;
    observedFrom: string | null;
    observedTo: string | null;
  };
};

/**
 * Operational failures that describe degraded COLLECTION. They are recorded and
 * reported, and the product surfaces them through availability and evidence
 * classes, but they never block activation.
 */
export const ADVISORY_OPERATIONAL_FAILURES: Record<string, string> = {
  MISSING_SCHEDULED_WINDOWS:
    "One or more five-minute collection windows were never claimed.",
  NON_SUCCESS_CLAIMED_RUNS:
    "Claimed collector runs finished FAILED, PARTIAL or RUNNING.",
  ASSET_COVERAGE:
    "At least one window observed fewer assets than the tracked universe.",
  PROVIDER_ERRORS:
    "The provider returned HTTP errors or malformed payloads during the scope.",
  ITEMS_FRESHNESS_OUTSIDE_0_900_SECONDS:
    "Provider evidence age fell outside the expected 0-900 second band.",
  INVALID_OR_OVERRUN_DURATION:
    "A collector run reported no duration or overran its five-minute window.",
};

/**
 * Operational failures that describe CONTRADICTORY evidence. A snapshot built
 * on these cannot be trusted to mean what it says, so it is never activated.
 */
export const BLOCKING_OPERATIONAL_FAILURES: Record<string, string> = {
  DUPLICATE_INTEGRITY:
    "Duplicate claimed windows or duplicate run/asset pairs make the reading ambiguous.",
  OBSERVATION_TIMESTAMP_OUTSIDE_SCHEDULED_BUCKET:
    "An observation carries a timestamp that does not belong to its scheduled window.",
  OBSERVATIONS_FROM_UNCLAIMED_RUN:
    "Observations exist for a run that never claimed its window.",
};

/** The scope is closed only once its final five-minute bucket has fully elapsed. */
export function scopeIsClosed(scope: Scope, now: number): boolean {
  const to = Date.parse(scope.to);
  return Number.isFinite(to) && to <= Math.floor(now / STEP) * STEP;
}

type ReportShape = {
  snapshotId?: unknown;
  operationalFailures?: unknown;
  availability?: unknown;
};

export async function validateSnapshot(
  db: Queryable,
  args: {
    snapshotId: string;
    input: Input;
    expectedFeatures: number;
    expectedHistoryVersions: number;
    expectedHistoryValues: number;
    report: unknown;
    now?: number;
    maxDays?: number;
  },
): Promise<ValidationResult> {
  const now = args.now ?? Date.now();
  const blocking: Finding[] = [];
  const advisory: Finding[] = [];
  const add = (list: Finding[], code: string, detail: string) =>
    list.push({ code, detail });

  // 1. The snapshot must be readable back out of the database it was written to.
  const parent = await db.query(
    "select id, method, scope, report, created_at from derived_market_snapshots where id=$1",
    [args.snapshotId],
  );
  if (!parent.rows.length)
    throw new SnapshotUnreadable(
      `Snapshot ${args.snapshotId} could not be read back after persistence.`,
    );
  const row = parent.rows[0];
  const persistedScope = (
    typeof row.scope === "string" ? JSON.parse(row.scope) : row.scope
  ) as Scope;
  const persistedReport = (
    typeof row.report === "string" ? JSON.parse(row.report) : row.report
  ) as ReportShape;

  const counts = await db.query(
    `select
       (select count(*) from derived_market_features where snapshot_id=$1) as features,
       (select count(*) from derived_history_versions where snapshot_id=$1) as versions,
       (select count(*) from derived_history_values where snapshot_id=$1) as values,
       (select count(distinct asset_id) from derived_market_features where snapshot_id=$1) as assets,
       (select min(observed_at) from derived_market_features where snapshot_id=$1) as observed_from,
       (select max(observed_at) from derived_market_features where snapshot_id=$1) as observed_to`,
    [args.snapshotId],
  );
  const c = counts.rows[0];
  const n = (v: unknown) => Number(v ?? 0);
  const readBack = {
    method: String(row.method),
    scope: persistedScope,
    createdAt: new Date(row.created_at as string).toISOString(),
    features: n(c.features),
    historyVersions: n(c.versions),
    historyValues: n(c.values),
    assets: n(c.assets),
    observedFrom: c.observed_from
      ? new Date(c.observed_from as string).toISOString()
      : null,
    observedTo: c.observed_to
      ? new Date(c.observed_to as string).toISOString()
      : null,
  };

  // 2. Contract compatibility. A snapshot produced by a different method cannot
  //    be read by the current product code even if every row is intact.
  if (readBack.method !== METHOD)
    add(
      blocking,
      "INCOMPATIBLE_METHOD",
      `Snapshot method ${readBack.method} is not the method this build reads (${METHOD}).`,
    );

  // 3. Substance. An empty snapshot is syntactically valid and useless; it would
  //    replace a working product surface with nothing.
  if (!persistedScope?.assets?.length)
    add(blocking, "ZERO_ASSETS", "The snapshot scope contains no assets.");
  if (readBack.features === 0)
    add(blocking, "ZERO_FEATURES", "The snapshot contains no feature rows.");
  if (readBack.assets === 0)
    add(
      blocking,
      "ZERO_OBSERVED_ASSETS",
      "No asset in the snapshot has a single feature row.",
    );

  // 4. The scope must be closed. An open trailing bucket means a later refresh
  //    over the same nominal scope would legitimately produce different content
  //    for the same window, which breaks the content-addressed identity.
  if (!scopeIsClosed(persistedScope, now))
    add(
      blocking,
      "SCOPE_NOT_CLOSED",
      `Scope ends at ${persistedScope?.to} which is not a fully elapsed five-minute bucket.`,
    );

  // 5. Persistence fidelity: what we computed is exactly what landed.
  const mismatches: string[] = [];
  if (readBack.features !== args.expectedFeatures)
    mismatches.push(
      `features ${readBack.features} persisted vs ${args.expectedFeatures} derived`,
    );
  if (readBack.historyVersions !== args.expectedHistoryVersions)
    mismatches.push(
      `history versions ${readBack.historyVersions} vs ${args.expectedHistoryVersions}`,
    );
  if (readBack.historyValues !== args.expectedHistoryValues)
    mismatches.push(
      `history values ${readBack.historyValues} vs ${args.expectedHistoryValues}`,
    );
  if (mismatches.length)
    add(blocking, "PERSISTED_COUNT_MISMATCH", mismatches.join("; "));

  // 6. Referential integrity of what was actually stored. The schema's foreign
  //    keys already forbid most of this; the check exists so a schema that was
  //    relaxed out from under us is detected rather than assumed.
  const orphans = await db.query(
    `select
       (select count(*) from derived_market_features f
          where f.snapshot_id=$1 and f.history_version is not null
            and not exists (select 1 from derived_history_versions v
                              where v.snapshot_id=f.snapshot_id and v.version=f.history_version)) as orphan_features,
       (select count(*) from derived_history_values h
          where h.snapshot_id=$1
            and not exists (select 1 from derived_history_versions v
                              where v.snapshot_id=h.snapshot_id and v.version=h.version)) as orphan_values,
       (select count(*) from derived_market_features
          where snapshot_id=$1 and feature->'values' is null) as valueless_features`,
    [args.snapshotId],
  );
  const o = orphans.rows[0];
  const integrity = [
    [n(o.orphan_features), "feature rows reference a missing history version"],
    [n(o.orphan_values), "history values reference a missing history version"],
    [n(o.valueless_features), "feature rows carry no values object"],
  ] as const;
  for (const [count, description] of integrity)
    if (count > 0)
      add(blocking, "PERSISTED_INTEGRITY_MISMATCH", `${count} ${description}.`);

  // 7. Identity. Recomputed independently from the source input against the
  //    scope that was actually stored, so a scope mutated in flight is caught.
  const data = prepare(args.input, args.maxDays);
  const recomputed = snapshotIdentity(
    { ...persistedScope, assets: [...(persistedScope?.assets ?? [])].sort() },
    data.runs,
    data.raw.map(observationDigest),
  );
  if (recomputed !== args.snapshotId)
    add(
      blocking,
      "SNAPSHOT_IDENTITY_MISMATCH",
      `Recomputed identity ${recomputed} does not match persisted identity ${args.snapshotId}.`,
    );
  if (String(row.id) !== args.snapshotId)
    add(
      blocking,
      "SNAPSHOT_IDENTITY_MISMATCH",
      `Stored row id ${String(row.id)} does not match the requested identity.`,
    );
  if (persistedReport?.snapshotId !== args.snapshotId)
    add(
      blocking,
      "SNAPSHOT_IDENTITY_MISMATCH",
      "The persisted report names a different snapshot than the row that carries it.",
    );

  // The report is what the product reads for availability and provenance, so a
  // report that did not survive the round trip byte-for-byte is a contract fault.
  // jsonb does not preserve key order, so the round trip is compared on a
  // canonical form. Anything else would flag every healthy snapshot.
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  const hash = (v: unknown) =>
    createHash("sha256")
      .update(JSON.stringify(canonical(v)) ?? "")
      .digest("hex");
  if (hash(persistedReport) !== hash(args.report))
    add(
      blocking,
      "REPORT_HASH_MISMATCH",
      "The persisted report does not match the report that was computed.",
    );
  const availability =
    persistedReport?.availability &&
    typeof persistedReport.availability === "object" &&
    !Array.isArray(persistedReport.availability)
      ? (persistedReport.availability as Record<string, { state?: string }>)
      : null;
  if (!availability || !Object.keys(availability).length)
    add(
      blocking,
      "INCOMPATIBLE_REPORT_CONTRACT",
      "The persisted report carries no per-asset availability map.",
    );

  // 8. Operational failures, split on the incomplete/contradictory line.
  const failures = Array.isArray(persistedReport?.operationalFailures)
    ? (persistedReport.operationalFailures as string[])
    : [];
  for (const code of failures) {
    if (code in BLOCKING_OPERATIONAL_FAILURES)
      add(blocking, code, BLOCKING_OPERATIONAL_FAILURES[code]);
    else if (code in ADVISORY_OPERATIONAL_FAILURES)
      add(advisory, code, ADVISORY_OPERATIONAL_FAILURES[code]);
    else
      // An unrecognised failure code means this build does not know what the
      // producing build was complaining about. Refuse rather than assume benign.
      add(
        blocking,
        "UNRECOGNISED_OPERATIONAL_FAILURE",
        `Operational failure ${code} is not classified by this build.`,
      );
  }

  // Assets with no active listing are a real market state, not a defect. They
  // are recorded so the operator can see how much of the universe is quiet.
  const states = Object.values(availability ?? {});
  const quiet = states.filter(
    (a) => a?.state === "NO_ACTIVE_LISTING_OBSERVED",
  ).length;
  const unknown = states.filter(
    (a) => a?.state === "PROVIDER_OR_COVERAGE_UNKNOWN",
  ).length;
  if (quiet)
    add(
      advisory,
      "ASSETS_WITHOUT_ACTIVE_LISTING",
      `${quiet} asset(s) had no active listing observed in scope.`,
    );
  if (unknown)
    add(
      advisory,
      "ASSETS_WITH_UNKNOWN_AVAILABILITY",
      `${unknown} asset(s) have provider or coverage gaps and no determinable availability.`,
    );

  return {
    snapshotId: args.snapshotId,
    publishable: blocking.length === 0,
    blocking,
    advisory,
    readBack,
  };
}

/** Distinguishes "cannot be read at all" from "read and found wanting". */
export class SnapshotUnreadable extends Error {
  readonly code = "SNAPSHOT_NOT_READABLE";
  constructor(message: string) {
    super(message);
    this.name = "SnapshotUnreadable";
  }
}
