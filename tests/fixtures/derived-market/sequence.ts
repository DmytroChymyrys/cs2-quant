import { type Input, STEP } from "../../../src/lib/derived-market/model";
export const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export function sequence(count = 300, assets = 3, changeAt = 214): Input {
  const start = Date.parse("2026-09-09T17:55:00.000Z"),
    iso = (n: number) => new Date(n).toISOString();
  const input: Input = {
    scope: {
      from: iso(start),
      to: iso(start + count * STEP),
      assets: Array.from({ length: assets }, (_, i) => `Fixture asset ${i}`),
    },
    runs: [],
    observations: [],
  };
  for (let i = 0; i < count; i++) {
    const t = start + i * STEP,
      changed = i >= changeAt;
    input.runs.push({
      id: uuid(i + 1),
      source: "SKINPORT",
      window: iso(t),
      startedAt: iso(t + 1000),
      claimed: true,
      status: "SUCCESS",
      durationMs: 6000,
      itemsStatus: 200,
      historyStatus: 200,
      errorCode: null,
      upstreamErrors: [],
      historyHash: changed ? "b".repeat(64) : "a".repeat(64),
      historyFetchedAt: iso(t + 4000),
    });
    for (let a = 0; a < assets; a++)
      input.observations.push({
        id: uuid(10000 + i * assets + a),
        runId: uuid(i + 1),
        assetId: uuid(100000 + a),
        name: input.scope.assets[a],
        observedAt: iso(t + 6000),
        itemsSourceAt: iso(t - 300000),
        minPrice: a === 0 ? (i % 2 ? "110" : "100") : "100",
        medianPrice: a === 0 ? (i % 2 ? "120" : "110") : "110",
        quantity: a === 1 ? 100 + (i % 2) : 100,
        history: {
          market_hash_name: input.scope.assets[a],
          currency: "USD",
          last_24_hours: { volume: changed ? 20 : 10 },
        },
      });
  }
  return input;
}
