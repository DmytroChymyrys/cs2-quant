// Explicit offline presentation export; never runs during build or page rendering.
import { writeFileSync } from "node:fs";
import {
  demoDataset,
  DEMO_AS_OF,
  DEMO_SEED,
} from "../src/lib/product/intelligence/demo";
import { DEMO_UNIVERSE } from "../src/lib/product/intelligence/demo-universe";
import { summary, seriesPoint } from "../src/lib/product/intelligence/map";
const dataset = demoDataset();
const selected = [0, 2, 3, 4, 7].map((i) => DEMO_UNIVERSE[i]);
const assets = selected.map((a) => {
  const rows = dataset.features.filter((f) => f.asset_id === a.id);
  return {
    ...summary(rows.at(-1)!, rows.length, 2016, DEMO_AS_OF, null),
    artwork: { ...a.artwork, url: `/demo-artwork/${a.id}.png` },
  };
});
const series = dataset.features
  .filter((f) => f.asset_id === assets[0].id)
  .slice(-288)
  // Explicit arrow: map would otherwise pass the index as the contract id.
  .map((f) => seriesPoint(f));
writeFileSync(
  "config/product-showcase/demo.json",
  JSON.stringify({
    evidence: "SYNTHETIC",
    seed: DEMO_SEED,
    asOf: DEMO_AS_OF,
    assets,
    series,
  }) + "\n",
);
console.info(
  "Exported existing seeded demo presentation only; no DB/network access.",
);
