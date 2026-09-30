import { readFile, writeFile } from "node:fs/promises";
import { call, saveArtifact, summary, sha256 } from "./client.mjs";

const SELECT = JSON.parse(await readFile("reports/steamwebapi-probe/step3-meta.json", "utf8"));
const first = JSON.parse(await readFile("reports/steamwebapi-probe/universe-raw.json", "utf8"));
const firstAt = SELECT.meta.at;
const firstHash = SELECT.meta.responseSha256;

/* Field families, which is also the Phase M fingerprint recommendation input. */
const MARKET = ["pricelatest","pricelatestsell","pricemedian","pricemedian24h","pricemedian7d","pricemedian30d","pricemedian90d","priceavg","pricesafe","pricemin","pricemax","pricemix"];
const DEMAND = ["buyorderprice","buyordermedian","buyordervolume"];
const SUPPLY = ["offervolume"];
const VOLUME = ["soldtoday","sold24h","sold7d","sold30d","sold90d","soldtotal","marketvolume","points"];
const THIRD  = ["pricereal","pricerealmedian","realmarketsquantity","winloss","winlossprice"];
const META   = ["rarity","quality","itemgroup","itemtype","itemname","wear","isstattrak","issouvenir","isstar","minfloat","maxfloat","defindex","paintindex","marketable","tradable","unstable","tag1","tag7","groupname","markettradablerestriction"];
const RETRIEVAL = ["priceupdatedat","createdat","hourstosold","lateststeamsellat","firstseenat","releasedat"];
const FAMILIES = { MARKET, DEMAND, SUPPLY, VOLUME, THIRD, META, RETRIEVAL };
const stateOf = (r) => sha256([...MARKET, ...DEMAND, ...SUPPLY, ...VOLUME, ...THIRD].map((f) => r[f] ?? null));

const select = Object.keys(first[0]).join(",");
const r = await call("/steam/api/items", {
  query: { game: "cs2", production: 1, max: 50000, select },
  bucket: "ITEMS", label: "items full universe (repeat)", keepRaw: true,
});
const second = Array.isArray(r.json) ? r.json : [];
const minutes = (Date.parse(r.at) - Date.parse(firstAt)) / 60000;
console.log(`pull#1 ${firstAt}\npull#2 ${r.at}\ninterval = ${minutes.toFixed(1)} min`);
console.log(`rows: ${first.length} -> ${second.length}`);
console.log(`response sha256 identical: ${firstHash === r.responseSha256}`);

const a = new Map(first.map((x) => [x.markethashname, x]));
const b = new Map(second.map((x) => [x.markethashname, x]));
let stateChanged = 0, anyChanged = 0;
const familyCounts = Object.fromEntries(Object.keys(FAMILIES).map((k) => [k, 0]));
const fieldCounts = new Map();
for (const [name, y] of b) {
  const x = a.get(name);
  if (!x) continue;
  if (stateOf(x) !== stateOf(y)) stateChanged++;
  let changed = false;
  for (const [fam, fields] of Object.entries(FAMILIES)) {
    let famChanged = false;
    for (const f of fields) {
      const same = JSON.stringify(x[f] ?? null) === JSON.stringify(y[f] ?? null);
      if (!same) { famChanged = true; fieldCounts.set(f, (fieldCounts.get(f) ?? 0) + 1); }
    }
    if (famChanged) { familyCounts[fam]++; changed = true; }
  }
  if (changed) anyChanged++;
}
const common = [...b.keys()].filter((k) => a.has(k)).length;
console.log(`\ncommon assets = ${common}`);
console.log(`meaningful market state changed = ${stateChanged} (${((stateChanged/common)*100).toFixed(2)}%)`);
console.log(`any field changed              = ${anyChanged} (${((anyChanged/common)*100).toFixed(2)}%)`);
console.log(`\nchanged by family:`);
for (const [fam, c] of Object.entries(familyCounts))
  console.log(`  ${fam.padEnd(11)} ${String(c).padStart(6)}  ${((c/common)*100).toFixed(2)}%`);
console.log(`\ntop changed fields:`);
for (const [f, c] of [...fieldCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14))
  console.log(`  ${f.padEnd(22)} ${String(c).padStart(6)}  ${((c/common)*100).toFixed(2)}%`);
console.log(`\nnew=${[...b.keys()].filter((k)=>!a.has(k)).length}  disappeared=${[...a.keys()].filter((k)=>!b.has(k)).length}`);

await writeFile("reports/steamwebapi-probe/universe-raw-2.json", r.raw ?? "");
await saveArtifact("docs/evidence/steamwebapi/repeat-observation.json", {
  pull1At: firstAt, pull2At: r.at, intervalMinutes: +minutes.toFixed(1),
  rows1: first.length, rows2: second.length,
  responseHashIdentical: firstHash === r.responseSha256,
  responseSha256: { pull1: firstHash, pull2: r.responseSha256 },
  common, stateChanged, anyChanged,
  familyCounts,
  topChangedFields: Object.fromEntries([...fieldCounts.entries()].sort((x,y)=>y[1]-x[1]).slice(0, 25)),
  newAssets: [...b.keys()].filter((k)=>!a.has(k)).length,
  disappeared: [...a.keys()].filter((k)=>!b.has(k)).length,
  fingerprintRecommendation: {
    includeInStateHash: [...MARKET, ...DEMAND, ...SUPPLY, ...VOLUME, ...THIRD],
    excludeFromStateHash: RETRIEVAL,
    metadataSeparately: META,
  },
});
console.log("\nledger:", JSON.stringify(summary()));
