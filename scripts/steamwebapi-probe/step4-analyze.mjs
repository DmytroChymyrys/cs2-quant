import { readFile } from "node:fs/promises";
import { saveArtifact } from "./client.mjs";

const rows = JSON.parse(await readFile("reports/steamwebapi-probe/universe-raw.json", "utf8"));
const n = rows.length;
const pct = (x) => `${((x / n) * 100).toFixed(2)}%`;

/* ---- universe shape ---- */
const names = rows.map((r) => r.markethashname);
const unique = new Set(names);
const dupCounts = new Map();
for (const nm of names) dupCounts.set(nm, (dupCounts.get(nm) ?? 0) + 1);
const dups = [...dupCounts.entries()].filter(([, c]) => c > 1);

const tally = (key) => {
  const m = new Map();
  for (const r of rows) {
    const v = r[key] ?? "(null)";
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`rows=${n}  uniqueNames=${unique.size}  duplicateNames=${dups.length}`);
console.log(`empty/null names=${names.filter((x) => !x || !String(x).trim()).length}`);
if (dups.length) console.log("top duplicates:", dups.sort((a,b)=>b[1]-a[1]).slice(0, 5));

console.log("\n=== itemgroup ===");
for (const [k, c] of tally("itemgroup").slice(0, 20)) console.log(`  ${String(k).padEnd(22)} ${String(c).padStart(6)}  ${pct(c)}`);
console.log("\n=== tag1 (type) ===");
for (const [k, c] of tally("tag1").slice(0, 20)) console.log(`  ${String(k).padEnd(22)} ${String(c).padStart(6)}  ${pct(c)}`);
console.log("\n=== wear ===");
for (const [k, c] of tally("wear")) console.log(`  ${String(k).padEnd(22)} ${String(c).padStart(6)}  ${pct(c)}`);
console.log("\n=== rarity (top) ===");
for (const [k, c] of tally("rarity").slice(0, 12)) console.log(`  ${String(k).padEnd(28)} ${String(c).padStart(6)}  ${pct(c)}`);
console.log(`\nStatTrak=${rows.filter(r=>r.isstattrak).length}  Souvenir=${rows.filter(r=>r.issouvenir).length}  star(knife/glove)=${rows.filter(r=>r.isstar).length}`);
console.log(`marketable=${rows.filter(r=>r.marketable).length}  tradable=${rows.filter(r=>r.tradable).length}  unstable=${rows.filter(r=>r.unstable).length}`);

/* ---- field inventory: type, null%, zero%, example ---- */
const fields = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
const inventory = fields.map((f) => {
  let nulls = 0, zeros = 0, negatives = 0, example = null, types = new Set();
  for (const r of rows) {
    const v = r[f];
    if (v === null || v === undefined) { nulls++; continue; }
    types.add(Array.isArray(v) ? "array" : typeof v);
    if (typeof v === "number") { if (v === 0) zeros++; if (v < 0) negatives++; }
    if (example === null && v !== "" ) example = v;
  }
  return {
    field: f,
    types: [...types].join("|") || "null-only",
    nullPct: +(((nulls / n) * 100).toFixed(2)),
    zeroPct: +(((zeros / n) * 100).toFixed(2)),
    negatives,
    example: typeof example === "object" ? JSON.stringify(example).slice(0, 80) : example,
  };
});
console.log("\n=== field inventory (null% / zero%) ===");
console.log("field".padEnd(28) + "type".padEnd(16) + "null%".padStart(8) + "zero%".padStart(8) + "  neg");
for (const f of inventory)
  console.log(f.field.padEnd(28) + f.types.padEnd(16) + String(f.nullPct).padStart(8) + String(f.zeroPct).padStart(8) + String(f.negatives).padStart(6));

await saveArtifact("docs/evidence/steamwebapi/field-inventory.json", { rows: n, fields: inventory });
await saveArtifact("docs/evidence/steamwebapi/universe-composition.json", {
  rows: n, uniqueNames: unique.size, duplicateNames: dups.length,
  itemgroup: Object.fromEntries(tally("itemgroup")),
  tag1: Object.fromEntries(tally("tag1")),
  wear: Object.fromEntries(tally("wear")),
  rarity: Object.fromEntries(tally("rarity")),
  flags: {
    stattrak: rows.filter(r=>r.isstattrak).length,
    souvenir: rows.filter(r=>r.issouvenir).length,
    star: rows.filter(r=>r.isstar).length,
    marketable: rows.filter(r=>r.marketable).length,
    tradable: rows.filter(r=>r.tradable).length,
    unstable: rows.filter(r=>r.unstable).length,
  },
});
