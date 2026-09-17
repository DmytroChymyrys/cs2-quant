import { derive } from "../../derived-market/features";
import type { Input } from "../../derived-market/model";
export const FIXTURE_AS_OF = "2026-09-09T17:55:00.000Z";
const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
let cached: ReturnType<typeof derive> | undefined;
export function fixtureDataset() {
  if (cached) return cached;
  const names = [
    "Active price",
    "Quiet market",
    "Rising price",
    "Falling price",
    "Contracting listings",
    "Expanding listings",
    "High volatility",
    "Missing observations",
    "Stale source",
    "Insufficient history",
  ].map((n) => `Synthetic · ${n}`);
  const end = Date.parse(FIXTURE_AS_OF),
    count = 2016,
    start = end - count * 300000,
    iso = (t: number) => new Date(t).toISOString();
  const input: Input = {
    scope: { from: iso(start), to: iso(end), assets: names },
    runs: [],
    observations: [],
  };
  for (let i = 0; i < count; i++) {
    const t = start + i * 300000,
      version = i >= 1500;
    input.runs.push({
      id: id(i + 1),
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
      historyHash: (version ? "b" : "a").repeat(64),
      historyFetchedAt: iso(t + 4000),
      missingAssets: [],
    });
    for (let a = 0; a < names.length; a++) {
      if ((a === 7 && i % 23 === 0) || (a === 9 && i < count - 8)) continue;
      const price =
        a === 0
          ? 100 + (i % 3) * 2
          : a === 2
            ? 30 + i * 0.05
            : a === 3
              ? 200 - i * 0.05
              : a === 6
                ? 100 + (i % 2) * 30
                : 100;
      input.observations.push({
        id: id(100000 + i * 10 + a),
        runId: id(i + 1),
        assetId: id(900000 + a),
        name: names[a],
        observedAt: iso(t + 6000),
        itemsSourceAt: iso(t - (a === 8 ? 3600000 : 300000)),
        minPrice: price.toFixed(8),
        medianPrice: (price + 5).toFixed(8),
        quantity:
          a === 4 ? 2100 - i : a === 5 ? Math.round(100 * 1.003 ** i) : 100,
        history: { last_24_hours: { volume: version ? 20 : 10 } },
      });
    }
  }
  return (cached = derive(input));
}
