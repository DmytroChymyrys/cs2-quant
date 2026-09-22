import { ACTIVE_PROFILE } from "./cadence";
import {
  type Input,
  type Feature,
  type Run,
  type Scope,
  type RawObservation,
  METHOD,
  DEFAULT_SCOPE_DAYS,
} from "./model";
import { prepare, observationDigest, snapshotIdentity } from "./prepare";
import {
  assetFeatures,
  buildHistoryVersions,
  type AssetContext,
  type Derived,
} from "./features";

export type AssetChunkLoader = (assetName: string) => Promise<RawObservation[]>;
export type FeatureSink = (
  assetName: string,
  features: Feature[],
) => void | Promise<void>;

/**
 * Derives one asset at a time so a long research scope never holds the whole
 * universe in memory. Every horizon baseline is internal to a single asset, so
 * per-asset derivation is exact rather than approximate: for identical input this
 * produces byte-identical features and the same snapshot ID as `derive`.
 *
 * Features are handed to `onFeatures` per asset and are not accumulated here.
 */
export async function deriveChunked(
  scope: Scope,
  runs: Run[],
  assetNames: string[],
  loadAsset: AssetChunkLoader,
  onFeatures: FeatureSink,
  maxDays: number = DEFAULT_SCOPE_DAYS,
): Promise<Omit<Derived, "features"> & { observations: number }> {
  // Runs are window-level, so History episodes are built once for every asset.
  const seed = prepare({ scope, runs, observations: [] }, maxDays);
  const { historyVersions, historyByRun } = buildHistoryVersions(
    seed.claimed,
    seed.duplicateWindows,
  );
  const historyValues: Derived["historyValues"] = [];
  const ctx: AssetContext = {
    profile: ACTIVE_PROFILE,
    runMap: seed.runMap,
    historyByRun,
    dimensions: new Map<string, string>(),
    historyValues,
  };
  const observationDigests: string[] = [];
  const duplicatePairs: string[] = [];
  let observations = 0;

  for (const assetName of assetNames) {
    const chunk = await loadAsset(assetName);
    if (!chunk.length) continue;
    const data = prepare({ scope, runs, observations: chunk }, maxDays);
    for (const o of data.raw) observationDigests.push(observationDigest(o));
    duplicatePairs.push(...data.duplicatePairs);
    observations += data.raw.length;
    const features: Feature[] = [];
    for (const assetRows of Map.groupBy(data.valid, (o) => o.assetId).values())
      features.push(...assetFeatures(assetRows, ctx));
    if (features.length) await onFeatures(assetName, features);
  }

  const sortedScope = { ...scope, assets: [...scope.assets].sort() };
  return {
    snapshotId: snapshotIdentity(sortedScope, seed.runs, observationDigests),
    method: METHOD,
    scope: sortedScope,
    historyVersions,
    historyValues,
    excludedDuplicateWindows: seed.duplicateWindows,
    excludedDuplicatePairs: duplicatePairs.sort(),
    observations,
  };
}

/** Adapts an in-memory Input to the chunked path; used by tests and small scopes. */
export function memoryChunkLoader(input: Input): AssetChunkLoader {
  const byName = Map.groupBy(input.observations, (o) => o.name);
  return async (assetName: string) => byName.get(assetName) ?? [];
}
