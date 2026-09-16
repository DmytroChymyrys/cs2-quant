import { createHash } from "node:crypto";
import {
  type Input,
  type Run,
  type Scope,
  type RawObservation,
  validateScope,
  STEP,
  METHOD,
  DEFAULT_SCOPE_DAYS,
} from "./model";
export function digest(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, canonical(x)]),
      );
    return v;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
// Content identity of one raw observation. The History payload contributes as a
// content hash rather than an inlined copy, so identity is preserved while the
// hashed structure stays small enough to build one asset at a time.
export function observationDigest(o: RawObservation): string {
  return digest({
    id: o.id,
    runId: o.runId,
    assetId: o.assetId,
    name: o.name,
    observedAt: o.observedAt,
    itemsSourceAt: o.itemsSourceAt,
    minPrice: o.minPrice,
    medianPrice: o.medianPrice,
    quantity: o.quantity,
    historySha256: o.history === null ? null : digest(o.history),
  });
}
// Sorted observation digests make the snapshot ID independent of the order in
// which assets are derived, so batch and chunked derivation agree exactly.
export function snapshotIdentity(
  scope: Scope,
  runs: Run[],
  observationDigests: string[],
): string {
  return digest({
    method: METHOD,
    scope,
    runs,
    observationDigests: [...observationDigests].sort(),
  });
}
export function prepare(input: Input, maxDays: number = DEFAULT_SCOPE_DAYS) {
  const { from, to } = validateScope(input.scope, maxDays);
  const runs = input.runs
    .filter(
      (r) =>
        r.source === "SKINPORT" &&
        Date.parse(r.window) >= from &&
        Date.parse(r.window) < to,
    )
    .sort(
      (a, b) => a.window.localeCompare(b.window) || a.id.localeCompare(b.id),
    );
  const claimed = runs.filter((r) => r.claimed);
  const windowGroups = Map.groupBy(claimed, (r) => r.window);
  const duplicateWindows = [...windowGroups]
    .filter(([, r]) => r.length > 1)
    .map(([w]) => w);
  const unsafe = new Set(duplicateWindows);
  const runMap = new Map(runs.map((r) => [r.id, r]));
  const raw = input.observations.filter(
    (o) =>
      runMap.has(o.runId) &&
      input.scope.assets.includes(o.name) &&
      Date.parse(o.observedAt) >= from &&
      Date.parse(o.observedAt) < to,
  );
  const groups = Map.groupBy(raw, (o) => `${o.runId}:${o.assetId}`);
  const duplicatePairs = [...groups]
    .filter(([, rows]) => rows.length > 1)
    .map(([key]) => key);
  const invalidObservationIds = raw
    .filter((o) => {
      const window = Date.parse(runMap.get(o.runId)!.window),
        time = Date.parse(o.observedAt);
      return time < window || time >= window + STEP;
    })
    .map((o) => o.id);
  const invalid = new Set(invalidObservationIds);
  const valid = raw
    .filter((o) => {
      const r = runMap.get(o.runId)!;
      return (
        r.claimed &&
        !invalid.has(o.id) &&
        !unsafe.has(r.window) &&
        groups.get(`${o.runId}:${o.assetId}`)!.length === 1
      );
    })
    .sort(
      (a, b) =>
        a.assetId.localeCompare(b.assetId) ||
        runMap
          .get(a.runId)!
          .window.localeCompare(runMap.get(b.runId)!.window) ||
        a.id.localeCompare(b.id),
    );
  return {
    runs,
    claimed,
    raw,
    valid,
    runMap,
    duplicateWindows,
    duplicatePairs,
    invalidObservationIds,
  };
}
