import { readFile } from "node:fs/promises";
import { call, saveArtifact, summary } from "./client.mjs";

const rows = JSON.parse(await readFile("reports/steamwebapi-probe/universe-raw.json", "utf8"));
const byName = new Map(rows.map((r) => [r.markethashname, r]));
const find = (pred) => rows.find(pred);

/* Representative classes, resolved against the real universe so nothing is invented. */
const picks = [
  ["liquid rifle", "AK-47 | Redline (Field-Tested)"],
  ["expensive sniper", find((r) => /AWP \| Dragon Lore \(Field-Tested\)/.test(r.markethashname))?.markethashname],
  ["cheap liquid", find((r) => r.itemgroup === "rifle" && r.sold24h > 200 && r.pricemedian && r.pricemedian < 3)?.markethashname],
  ["case", find((r) => r.itemgroup === "container" && r.sold24h > 1000)?.markethashname],
  ["knife", "★ Karambit | Doppler (Factory New)"],
  ["glove", find((r) => r.itemgroup === "gloves" && r.sold30d > 5)?.markethashname],
  ["sticker", find((r) => r.itemgroup === "sticker" && r.sold24h > 20)?.markethashname],
  ["stattrak", find((r) => r.isstattrak && r.itemgroup === "rifle" && r.sold24h > 20)?.markethashname],
  ["souvenir", find((r) => r.issouvenir && r.sold30d > 5)?.markethashname],
  ["charm", find((r) => r.itemgroup === "charm" && r.sold24h > 5)?.markethashname],
].filter(([, name]) => name && byName.has(name));

console.log("resolved representative assets:");
for (const [cls, name] of picks) console.log(`  ${cls.padEnd(18)} ${name}`);

const detail = [];
for (const [cls, name] of picks) {
  const r = await call("/steam/api/item", {
    query: { market_hash_name: name, production: 1 },
    bucket: "ITEM",
    label: `item:${cls}`,
  });
  const d = Array.isArray(r.json) ? r.json[0] : r.json;
  const u = byName.get(name);
  detail.push({ class: cls, name, status: r.status, bytes: r.bytes, durationMs: r.durationMs, item: d, universeRow: u });
  await new Promise((s) => setTimeout(s, 700)); // stay well inside 100/min
}

const n = (v) => (v === null || v === undefined ? "—" : typeof v === "number" ? String(v) : String(v).slice(0, 18));
console.log("\n=== representative asset matrix (from /steam/api/item) ===");
console.log(
  "class".padEnd(17) + "latest".padStart(9) + "median".padStart(9) + "buyord".padStart(9) +
  "bqty".padStart(7) + "offers".padStart(7) + "s24h".padStart(7) + "s30d".padStart(8) + "real".padStart(9) + "mkts".padStart(6),
);
for (const d of detail) {
  const i = d.item ?? {};
  console.log(
    d.class.padEnd(17) + n(i.pricelatest).padStart(9) + n(i.pricemedian).padStart(9) + n(i.buyorderprice).padStart(9) +
    n(i.buyordervolume).padStart(7) + n(i.offervolume).padStart(7) + n(i.sold24h).padStart(7) + n(i.sold30d).padStart(8) +
    n(i.pricereal).padStart(9) + String(Array.isArray(i.prices) ? i.prices.length : "—").padStart(6),
  );
}
console.log("\nfields returned by /item vs /items(select):",
  detail[0]?.item ? Object.keys(detail[0].item).length : 0, "vs", Object.keys(rows[0]).length);
await saveArtifact("docs/evidence/steamwebapi/representative-assets.json", detail);
console.log("\nledger:", JSON.stringify(summary()));
