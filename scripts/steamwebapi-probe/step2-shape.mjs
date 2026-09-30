import { call, saveArtifact } from "./client.mjs";

/* One ITEMS call: three complete rows, info fields included, for the field
   inventory. Credits are charged per call, not per row, so this costs exactly
   what a full pull costs — take the widest possible rows. */
const r = await call("/steam/api/items", {
  query: { game: "cs2", max: 3, production: 0, pretty: 0 },
  bucket: "ITEMS",
  label: "items shape (max=3, production=0)",
  keepRaw: true,
});
console.log(`status=${r.status} duration=${r.durationMs}ms bytes=${r.bytes}`);
const rows = Array.isArray(r.json) ? r.json : r.json?.data ?? [];
console.log(`rows=${rows.length}  topLevelType=${Array.isArray(r.json) ? "array" : typeof r.json}`);
if (rows[0]) {
  const keys = Object.keys(rows[0]);
  console.log(`fields=${keys.length}`);
  console.log(keys.join(", "));
  console.log("\n--- avg row bytes ---", Math.round(r.bytes / Math.max(1, rows.length)));
}
await saveArtifact("reports/steamwebapi-probe/step2-shape.json", { meta: r, rows });
