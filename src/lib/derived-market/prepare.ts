import { createHash } from "node:crypto";
import { type Input, validateScope, STEP } from "./model";
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
export function prepare(input: Input) {
  const { from, to } = validateScope(input.scope);
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
