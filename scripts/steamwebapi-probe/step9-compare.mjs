import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { saveArtifact } from "./client.mjs";

/*
 * Phase H / K: SteamWebAPI's Skinport representation against FloatAlpha's own
 * direct Skinport collection, and name mapping against the canonical catalog.
 * Read-only: two SELECTs, no writes.
 */
const mirror = JSON.parse(await readFile("reports/steamwebapi-probe/skinport-mirror.json", "utf8"));
const universe = JSON.parse(await readFile("reports/steamwebapi-probe/universe-raw.json", "utf8"));
const mirrorByName = new Map(mirror.map((m) => [m.market_hash_name, m]));
const swaNames = new Set(universe.map((r) => r.markethashname));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const q = async (sql) => (await pool.query(sql)).rows;

const direct = await q(`
  select a.market_hash_name as name, s.min_price::float8 as min_price,
         s.quantity, s.present, s.observed_at
  from provider_assets a join provider_asset_state s on s.provider_asset_id = a.id
  where s.present`);
const canonical = await q(`select market_hash_name as name, is_tracked from assets`);
await pool.end();

console.log(`direct Skinport (present) = ${direct.length}`);
console.log(`canonical FloatAlpha assets = ${canonical.length} (tracked=${canonical.filter(c=>c.is_tracked).length})`);
console.log(`SteamWebAPI CS2 universe = ${universe.length}`);
console.log(`SteamWebAPI skinport mirror = ${mirror.length}`);

/* ---- Phase K: name mapping ---- */
const directNames = new Set(direct.map((d) => d.name));
const canonNames = new Set(canonical.map((c) => c.name));
const inter = (a, b) => [...a].filter((x) => b.has(x)).length;
console.log(`\n=== name mapping (exact market_hash_name) ===`);
console.log(`  canonical ∩ SteamWebAPI      = ${inter(canonNames, swaNames)} / ${canonNames.size}`);
console.log(`  canonical missing from SWA   = ${[...canonNames].filter((x)=>!swaNames.has(x)).length}`);
console.log(`  directSkinport ∩ SteamWebAPI = ${inter(directNames, swaNames)} / ${directNames.size}`);
console.log(`  directSkinport missing SWA   = ${[...directNames].filter((x)=>!swaNames.has(x)).length}`);
console.log(`  SWA not in direct Skinport   = ${[...swaNames].filter((x)=>!directNames.has(x)).length}`);

/* ---- Phase H: numeric comparison on the overlap ---- */
const pairs = [];
for (const d of direct) {
  const m = mirrorByName.get(d.name);
  if (!m || typeof m.price !== "number" || !d.min_price) continue;
  pairs.push({
    name: d.name, ours: d.min_price, theirs: m.price,
    ourQty: d.quantity, theirQty: m.quantity,
    diff: m.price - d.min_price,
    pctDiff: ((m.price - d.min_price) / d.min_price) * 100,
    observedAt: d.observed_at, mirrorAt: m.createdat,
  });
}
const abs = pairs.map((p) => Math.abs(p.pctDiff)).sort((a, b) => a - b);
const pctl = (p) => abs.length ? abs[Math.min(abs.length - 1, Math.floor((p / 100) * abs.length))] : null;
const exact = pairs.filter((p) => p.diff === 0).length;
console.log(`\n=== price comparison on overlap (n=${pairs.length}) ===`);
console.log(`  exact match            ${exact} (${((exact/pairs.length)*100).toFixed(2)}%)`);
console.log(`  |Δ%| median            ${pctl(50)?.toFixed(2)}%`);
console.log(`  |Δ%| p75 / p90 / p99   ${pctl(75)?.toFixed(2)}% / ${pctl(90)?.toFixed(2)}% / ${pctl(99)?.toFixed(2)}%`);
console.log(`  within 1% / 5% / 10%   ${abs.filter(x=>x<=1).length} / ${abs.filter(x=>x<=5).length} / ${abs.filter(x=>x<=10).length}`);
const qty = pairs.filter((p) => typeof p.theirQty === "number" && typeof p.ourQty === "number");
const qtyExact = qty.filter((p) => p.ourQty === p.theirQty).length;
console.log(`  quantity exact match   ${qtyExact}/${qty.length} (${((qtyExact/qty.length)*100).toFixed(2)}%)`);
const lag = pairs.length ? (Date.parse(pairs[0].observedAt) - Date.parse(pairs[0].mirrorAt)) / 3600_000 : null;
console.log(`  timestamp lag          ours ${pairs[0]?.observedAt} vs mirror ${pairs[0]?.mirrorAt} (~${lag?.toFixed(1)}h)`);
console.log(`\n  worst divergences:`);
for (const p of [...pairs].sort((a,b)=>Math.abs(b.pctDiff)-Math.abs(a.pctDiff)).slice(0,5))
  console.log(`    ${p.name.slice(0,44).padEnd(45)} ours=${p.ours.toFixed(2)} theirs=${p.theirs.toFixed(2)} ${p.pctDiff.toFixed(1)}%`);

await saveArtifact("docs/evidence/steamwebapi/skinport-comparison.json", {
  directPresent: direct.length, canonical: canonical.length,
  swaUniverse: universe.length, swaMirror: mirror.length,
  mapping: {
    canonicalInSwa: inter(canonNames, swaNames), canonicalTotal: canonNames.size,
    directInSwa: inter(directNames, swaNames), directTotal: directNames.size,
    swaNotInDirect: [...swaNames].filter((x)=>!directNames.has(x)).length,
  },
  comparison: {
    n: pairs.length, exact,
    medianAbsPct: pctl(50), p75: pctl(75), p90: pctl(90), p99: pctl(99),
    within1: abs.filter(x=>x<=1).length, within5: abs.filter(x=>x<=5).length, within10: abs.filter(x=>x<=10).length,
    quantityExact: qtyExact, quantityCompared: qty.length,
  },
  worst: [...pairs].sort((a,b)=>Math.abs(b.pctDiff)-Math.abs(a.pctDiff)).slice(0,20),
});
