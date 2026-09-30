import { call, saveArtifact, summary } from "./client.mjs";
import { writeFile } from "node:fs/promises";

/*
 * One ITEMS call for the whole CS2 universe.
 *
 * Complete rows are ~4.9 KB, so an unfiltered pull would be well over 150 MB.
 * `select` keeps the scalar fields the probe needs to answer universe size,
 * coverage, freshness and quality, and leaves out the four bulky ones
 * (itemimage, steamurl, inspectlink, latest10steamsales) and the nested
 * `prices` array. Per-asset market detail is gathered later through the cheap
 * single-item endpoint instead of inflating 40,000 rows here.
 */
const SELECT = [
  "markethashname","classid","instanceid","groupid","id","slug","normalizedname",
  "pricelatest","pricelatestsell","pricemedian","pricemedian24h","pricemedian7d","pricemedian30d","pricemedian90d",
  "priceavg","pricesafe","pricemin","pricemax","pricemix",
  "buyorderprice","buyordermedian","buyordervolume","offervolume",
  "soldtoday","sold24h","sold7d","sold30d","sold90d","soldtotal","marketvolume","hourstosold","points",
  "priceupdatedat","lateststeamsellat","firstseenat","releasedat","createdat",
  "rarity","quality","itemgroup","itemtype","itemname","wear","isstattrak","issouvenir","isstar",
  "minfloat","maxfloat","defindex","paintindex",
  "marketable","tradable","unstable","markettradablerestriction",
  "pricereal","pricerealmedian","realmarketsquantity","winloss","winlossprice",
  "tag1","tag7","groupname",
].join(",");

const r = await call("/steam/api/items", {
  query: { game: "cs2", production: 1, max: 50000, select: SELECT },
  bucket: "ITEMS",
  label: "items full universe (select, production=1)",
  keepRaw: true,
});
console.log(`status=${r.status} duration=${r.durationMs}ms bytes=${r.bytes} (${(r.bytes/1e6).toFixed(1)} MB)`);
const rows = Array.isArray(r.json) ? r.json : r.json?.data ?? [];
console.log(`rows=${rows.length}`);
if (rows.length) {
  console.log(`selected fields returned=${Object.keys(rows[0]).length}`);
  console.log(`avg row bytes=${Math.round(r.bytes / rows.length)}`);
}
// Raw stays local: too large to commit, and the sanitized aggregates are what
// the report needs.
await writeFile("reports/steamwebapi-probe/universe-raw.json", r.raw ?? "");
await saveArtifact("reports/steamwebapi-probe/step3-meta.json", { meta: { ...r, raw: undefined }, ledger: summary() });
console.log("\nledger:", JSON.stringify(summary()));
