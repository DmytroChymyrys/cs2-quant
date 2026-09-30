import { call, saveArtifact, summary } from "./client.mjs";

const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const ASSET = "AK-47 | Redline (Field-Tested)";
const results = {};

const describe = (label, r, extract) => {
  const info = { status: r.status, bytes: r.bytes, durationMs: r.durationMs, error: r.error };
  if (r.status === 200 && extract) Object.assign(info, extract(r.json));
  results[label] = info;
  console.log(`${label.padEnd(34)} ${String(r.status).padStart(3)}  ${String(r.bytes).padStart(8)}B  ${String(r.durationMs).padStart(5)}ms  ${
    info.points !== undefined ? `points=${info.points} ${info.earliest ?? ""}→${info.latest ?? ""}` : (r.status !== 200 ? JSON.stringify(r.json)?.slice(0,110) ?? "" : "")}`);
};

/* Steam price history for one asset. */
let r = await call("/steam/api/history", {
  query: { market_hash_name: ASSET, production: 1 },
  bucket: "OTHER", label: "history steamwebapi",
});
describe("GET /history (steam, default)", r, (j) => {
  const a = Array.isArray(j) ? j : [];
  const dates = a.map((x) => x.createdat).filter(Boolean).sort();
  return { points: a.length, earliest: dates[0]?.slice(0,10), latest: dates.at(-1)?.slice(0,10), sample: a.slice(0,2) };
});
await wait(31_000);

/* Third-party market history for the same asset. */
r = await call("/steam/api/history", {
  query: { market_hash_name: ASSET, origin: "markets", production: 1 },
  bucket: "OTHER", label: "history markets",
});
describe("GET /history (origin=markets)", r, (j) => {
  const a = Array.isArray(j) ? j : [];
  const dates = a.map((x) => x.createdat).filter(Boolean).sort();
  return { points: a.length, earliest: dates[0]?.slice(0,10), latest: dates.at(-1)?.slice(0,10), sample: a.slice(0,2) };
});
await wait(31_000);

/* Aggregated multi-item history — documented as 1 credit regardless of item count. */
r = await call("/steam/api/items/history", {
  method: "POST",
  query: { markets: "steam", game: "cs2" },
  body: { items: [ASSET, "★ Karambit | Doppler (Factory New)", "Sealed Genesis Terminal"] },
  bucket: "OTHER", label: "items/history POST",
});
describe("POST /items/history (3 items)", r, (j) => {
  const a = Array.isArray(j) ? j : [];
  return { points: a.length, earliest: a[0]?.date?.slice(0,10), latest: a.at(-1)?.date?.slice(0,10), sample: a.slice(0,2) };
});
await wait(31_000);

/* Premium cross-market endpoints — expected to be plan-gated on Item Small. */
r = await call("/markets/history", {
  query: { market_hash_name: ASSET, markets: "skinport" },
  bucket: "OTHER", label: "markets/history",
});
describe("GET /markets/history (premium)", r, (j) => ({ points: Object.keys(j?.history ?? {}).length }));
await wait(31_000);

r = await call("/market/skinport/prices", {
  query: { market_hash_name: ASSET },
  bucket: "OTHER", label: "market/skinport/prices",
});
describe("GET /market/skinport/prices", r, (j) => ({ points: Array.isArray(j) ? j.length : 1, sample: j }));

await saveArtifact("docs/evidence/steamwebapi/history-capability.json", results);
console.log("\nledger:", JSON.stringify(summary()));
