import { readFile } from "node:fs/promises";
import { saveArtifact, sha256 } from "./client.mjs";

const a = JSON.parse(await readFile("reports/steamwebapi-probe/universe-raw.json", "utf8"));
const b = JSON.parse(await readFile("reports/steamwebapi-probe/universe-raw-2.json", "utf8"));
const A = new Map(a.map((x) => [x.markethashname, x]));
const STEAM = ["pricelatest","pricelatestsell","pricemedian","pricemedian24h","pricemedian7d","pricemedian30d","pricemedian90d","priceavg","pricesafe","pricemin","pricemax","pricemix","buyorderprice","buyordermedian","buyordervolume","offervolume","soldtoday","sold24h","sold7d","sold30d","sold90d","soldtotal","marketvolume","points"];
const THIRD = ["pricereal","pricerealmedian","realmarketsquantity","winloss","winlossprice"];
const h = (r, fs) => sha256(fs.map((f) => r[f] ?? null));

let steamChanged = 0, thirdChanged = 0, either = 0;
for (const y of b) {
  const x = A.get(y.markethashname);
  if (!x) continue;
  const s = h(x, STEAM) !== h(y, STEAM);
  const t = h(x, THIRD) !== h(y, THIRD);
  if (s) steamChanged++;
  if (t) thirdChanged++;
  if (s || t) either++;
}
const n = b.length, mins = 10.1;
const rate = (c) => (c / n) * 100;
console.log(`over ${mins} min, n=${n}`);
console.log(`  Steam-side state changed      ${steamChanged}  ${rate(steamChanged).toFixed(2)}%`);
console.log(`  third-party state changed     ${thirdChanged}  ${rate(thirdChanged).toFixed(2)}%`);
console.log(`  either                        ${either}  ${rate(either).toFixed(2)}%`);

/* A normalized change row: identity + the state fields + run linkage. */
const sample = b.slice(0, 500);
const rowBytes = Math.round(
  sample.reduce((t, r) => t + Buffer.byteLength(JSON.stringify(Object.fromEntries([...STEAM, ...THIRD].map((f) => [f, r[f] ?? null])))), 0) / sample.length,
);
const OVERHEAD = 120; // uuid keys, hashes, timestamps, run id
const ROW = rowBytes + OVERHEAD;
console.log(`\nestimated normalized state row = ${rowBytes}B payload + ${OVERHEAD}B overhead = ${ROW}B`);

const cadences = [
  ["5 min", 288], ["15 min", 96], ["30 min", 48], ["hourly", 24], ["2-hourly", 12], ["6-hourly", 4], ["daily", 1],
];
console.log(`\ncadence        calls/30d  vs 1500 quota   steam rows/day   all rows/day   storage/30d   storage/yr`);
const projections = [];
for (const [label, perDay] of cadences) {
  const calls = perDay * 30;
  // Change probability scales sub-linearly with interval; use the measured
  // 10-minute rate as a floor and cap at 100%.
  const factor = Math.min(1, (60 / perDay / mins));
  const steamRows = Math.min(n, Math.round(steamChanged * factor)) * perDay;
  const allRows = Math.min(n, Math.round(either * factor)) * perDay;
  const store30 = (allRows * 30 * ROW) / 1e9, storeYr = (allRows * 365 * ROW) / 1e9;
  projections.push({ label, callsPer30d: calls, withinQuota: calls <= 1500, steamRowsPerDay: steamRows, allRowsPerDay: allRows, storageGb30d: +store30.toFixed(2), storageGbYear: +storeYr.toFixed(2) });
  console.log(`${label.padEnd(14)} ${String(calls).padStart(8)}  ${(calls <= 1500 ? "OK" : "OVER").padStart(6)}        ${String(steamRows).padStart(10)}     ${String(allRows).padStart(10)}   ${store30.toFixed(2).padStart(7)} GB   ${storeYr.toFixed(1).padStart(6)} GB`);
}

/* Backfill cost: /history is 1 credit per asset, OTHER allowance is 500/period. */
console.log(`\nbackfill via GET /history (1 credit/asset, ~461 points @ default interval, 12.6y depth):`);
for (const [scope, count] of [["canonical tracked", 100], ["Skinport overlap", 24846], ["full SWA universe", 39703]]) {
  const pts = count * 461, bytes = pts * 60;
  console.log(`  ${scope.padEnd(20)} assets=${String(count).padStart(6)}  credits=${String(count).padStart(6)}  ${count <= 500 ? "fits OTHER 500/period" : "EXCEEDS 500/period"}  points≈${pts.toLocaleString()}  ≈${(bytes/1e6).toFixed(0)} MB`);
}
await saveArtifact("docs/evidence/steamwebapi/projections.json", {
  intervalMinutes: mins, universe: n,
  changed: { steam: steamChanged, third: thirdChanged, either },
  estimatedRowBytes: ROW, cadenceProjections: projections,
});
