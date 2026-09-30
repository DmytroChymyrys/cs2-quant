import { readFile } from "node:fs/promises";
import { saveArtifact } from "./client.mjs";

const rows = JSON.parse(await readFile("reports/steamwebapi-probe/universe-raw.json", "utf8"));
const now = Date.now();
const ms = (v) => {
  if (!v) return null;
  const s = typeof v === "object" ? v.date : v;
  const t = Date.parse(String(s).replace(" ", "T") + (typeof v === "object" && v.timezone === "UTC" ? "Z" : ""));
  return Number.isFinite(t) ? t : null;
};
const buckets = (values, edgesHours, label) => {
  const edges = edgesHours.map((h) => h * 3600_000);
  const counts = new Array(edges.length + 1).fill(0);
  let missing = 0;
  for (const v of values) {
    if (v === null) { missing++; continue; }
    const age = now - v;
    let i = edges.findIndex((e) => age <= e);
    if (i === -1) i = edges.length;
    counts[i]++;
  }
  console.log(`\n=== ${label} (age of value) ===`);
  edgesHours.forEach((h, i) =>
    console.log(`  <= ${String(h).padStart(5)}h  ${String(counts[i]).padStart(6)}  ${((counts[i]/rows.length)*100).toFixed(2)}%`));
  console.log(`  older      ${String(counts[edges.length]).padStart(6)}  ${((counts[edges.length]/rows.length)*100).toFixed(2)}%`);
  console.log(`  missing    ${String(missing).padStart(6)}  ${((missing/rows.length)*100).toFixed(2)}%`);
  return { label, edgesHours, counts, missing };
};

const priceUpdated = rows.map((r) => ms(r.priceupdatedat));
const lastSell = rows.map((r) => ms(r.lateststeamsellat));
const f1 = buckets(priceUpdated, [1, 6, 24, 72, 168, 720], "priceupdatedat");
const f2 = buckets(lastSell, [24, 168, 720, 2160, 8760], "lateststeamsellat (last Steam sale)");

/* Is the provider-reported "Steam prices broken" visible in the data? */
const withUpdate = priceUpdated.filter((x) => x !== null);
const newest = Math.max(...withUpdate), oldest = Math.min(...withUpdate);
console.log(`\npriceupdatedat newest=${new Date(newest).toISOString()}  oldest=${new Date(oldest).toISOString()}`);
console.log(`spread=${((newest - oldest) / 3600_000).toFixed(1)}h`);

console.log("\n=== pricelatest (current Steam listing) null rate by item group ===");
const byGroup = new Map();
for (const r of rows) {
  const g = r.itemgroup ?? "(null)";
  const e = byGroup.get(g) ?? { n: 0, nullLatest: 0, nullSell: 0 };
  e.n++;
  if (r.pricelatest === null || r.pricelatest === undefined) e.nullLatest++;
  if (r.pricelatestsell === null || r.pricelatestsell === undefined) e.nullSell++;
  byGroup.set(g, e);
}
for (const [g, e] of [...byGroup.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12))
  console.log(`  ${g.padEnd(16)} n=${String(e.n).padStart(6)}  pricelatest null=${((e.nullLatest/e.n)*100).toFixed(1)}%  pricelatestsell null=${((e.nullSell/e.n)*100).toFixed(1)}%`);

/* Semantic trap check: is 0 a measurement or an absence? */
console.log("\n=== zero-vs-null semantics ===");
const z = (f) => rows.filter((r) => r[f] === 0).length;
const nu = (f) => rows.filter((r) => r[f] === null || r[f] === undefined).length;
for (const f of ["offervolume","buyordervolume","sold24h","soldtoday","minfloat","marketvolume","points"])
  console.log(`  ${f.padEnd(16)} zero=${String(z(f)).padStart(6)}  null=${String(nu(f)).padStart(6)}  -> both present: ${z(f)>0 && nu(f)>0 ? "YES (0 is a measurement)" : "no"}`);

// Third-party coverage
const withReal = rows.filter((r) => r.pricereal !== null && r.pricereal !== undefined);
console.log(`\npricereal present=${withReal.length} (${((withReal.length/rows.length)*100).toFixed(2)}%)`);
const mq = new Map();
for (const r of rows) mq.set(r.realmarketsquantity, (mq.get(r.realmarketsquantity) ?? 0) + 1);
console.log("realmarketsquantity distribution:", [...mq.entries()].sort((a,b)=>a[0]-b[0]).map(([k,v])=>`${k}:${v}`).join(" "));

await saveArtifact("docs/evidence/steamwebapi/freshness.json", {
  generatedAt: new Date(now).toISOString(),
  priceUpdatedAt: f1, latestSteamSellAt: f2,
  priceUpdatedNewest: new Date(newest).toISOString(),
  priceUpdatedOldest: new Date(oldest).toISOString(),
  nullByGroup: Object.fromEntries([...byGroup].map(([g,e])=>[g,e])),
});
