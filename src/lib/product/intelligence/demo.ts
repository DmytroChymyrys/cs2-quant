import { derive } from "../../derived-market/features";
import { STEP, type Input } from "../../derived-market/model";
import { DEMO_UNIVERSE, type Archetype } from "./demo-universe";
export const DEMO_AS_OF = "2026-09-09T17:55:00.000Z";
export const DEMO_SEED = 7302026;
export function assertDemoAllowed() {
  if (process.env.NODE_ENV === "production")
    throw Error("DEMO_DISABLED_IN_PRODUCTION");
}
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Price-event probability, relative step size, quantity-event probability.
const profiles: Record<Archetype, [number, number, number]> = {
  rifle: [0.22, 0.0013, 0.44],
  knife: [0.045, 0.0024, 0.07],
  gloves: [0.035, 0.004, 0.09],
  case: [0.26, 0.003, 0.68],
  momentum: [0.32, 0.0018, 0.46],
  reverting: [0.2, 0.0022, 0.3],
  volatile: [0.28, 0.006, 0.35],
  quiet: [0.014, 0.0018, 0.035],
  contracting: [0.2, 0.0017, 0.47],
  expanding: [0.17, 0.0015, 0.52],
};
const iso = (t: number) => new Date(t).toISOString();
const rowId = (n: number) =>
  `de000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export function generateDemoObservations(
  seed = DEMO_SEED,
): Input & { evidence: "SYNTHETIC" } {
  assertDemoAllowed();
  const end = Date.parse(DEMO_AS_OF),
    count = 2016,
    start = end - count * STEP;
  const input: Input & { evidence: "SYNTHETIC" } = {
    evidence: "SYNTHETIC",
    scope: {
      from: iso(start),
      to: iso(end),
      assets: DEMO_UNIVERSE.map((a) => a.name),
    },
    runs: [],
    observations: [],
  };
  for (let i = 0; i < count; i++) {
    const t = start + i * STEP;
    input.runs.push({
      id: rowId(i),
      source: "SKINPORT",
      window: iso(t),
      startedAt: iso(t + 1000),
      claimed: true,
      status: "SUCCESS",
      durationMs: 6000,
      itemsStatus: 200,
      historyStatus: null,
      errorCode: null,
      upstreamErrors: [],
      historyHash: null,
      historyFetchedAt: null,
    });
  }
  for (const asset of DEMO_UNIVERSE) {
    const rand = random(seed ^ parseInt(asset.id.slice(0, 8), 16));
    const noise = () => rand() + rand() + rand() - 1.5;
    const [priceRate, step, qtyRate] = profiles[asset.archetype];
    let price = asset.reference,
      quantity = asset.depth,
      median = price * 1.035;
    let latentPrice = price;
    let regimeEnd = 0,
      intensity = 1,
      direction = 0,
      pressure = 0;
    let spread = 0.025 + rand() * 0.025;
    const contraction = asset.archetype === "contracting",
      expansion = asset.archetype === "expanding";
    for (let i = 0; i < count; i++) {
      if (i >= regimeEnd) {
        regimeEnd = i + 12 + Math.floor(rand() * 78);
        const choice = rand();
        intensity = choice < 0.32 ? 0.15 : choice > 0.75 ? 2.5 : 0.85;
        direction = noise() * 0.45;
        spread = Math.max(0.015, Math.min(0.085, spread + noise() * 0.004));
      }
      // Persistent shared activity/pressure, not independent white-noise prices and supply.
      pressure = pressure * 0.94 + noise() * 0.035;
      if (rand() < Math.min(0.9, qtyRate * intensity)) {
        const bias = contraction ? -0.24 : expansion ? 0.24 : -pressure * 0.25;
        const change = Math.round(
          (noise() + bias) * Math.max(2, asset.depth * 0.0018),
        );
        quantity = Math.max(
          1,
          Math.min(
            Math.round(asset.depth * 1.55),
            Math.max(Math.round(asset.depth * 0.45), quantity + change),
          ),
        );
      }
      if (rand() < Math.min(0.8, priceRate * intensity)) {
        const momentum = asset.archetype === "momentum" ? 0.09 : 0;
        const revert =
          asset.archetype === "reverting"
            ? -Math.log(price / asset.reference) * 14
            : -Math.log(price / asset.reference) * 0.6;
        // Delayed mild response on only one contraction example; no universal predictive law.
        const delayed =
          contraction && asset.reference > 10 && i > 700
            ? 0.09
            : expansion
              ? -0.025
              : 0;
        const delta =
          step * (noise() + direction + pressure + momentum + revert + delayed);
        latentPrice = Math.max(
          asset.reference * 0.65,
          Math.min(asset.reference * 1.5, latentPrice * Math.exp(delta)),
        );
        price = Math.round(latentPrice * 100) / 100;
        price = Math.max(0.01, price);
      }
      // Median adjusts in steps as the listing distribution changes; never below its floor.
      if (rand() < priceRate * intensity * 0.65 || median < price)
        median = Math.max(price, Math.round(price * (1 + spread) * 100) / 100);
      const t = start + i * STEP;
      input.observations.push({
        id: rowId(100000 + input.observations.length),
        runId: rowId(i),
        assetId: asset.id,
        name: asset.name,
        observedAt: iso(t + 6000),
        itemsSourceAt: iso(t - 300000),
        minPrice: price.toFixed(8),
        medianPrice: median.toFixed(8),
        quantity,
        history: null,
      });
    }
  }
  // Same ordering as a bounded chronological observation read.
  input.observations.sort(
    (a, b) =>
      a.observedAt.localeCompare(b.observedAt) ||
      a.assetId.localeCompare(b.assetId),
  );
  return input;
}
let cached: (ReturnType<typeof derive> & { evidence: "SYNTHETIC" }) | undefined;
export function demoDataset() {
  assertDemoAllowed();
  return (cached ??= {
    ...derive(generateDemoObservations()),
    evidence: "SYNTHETIC",
  });
}
