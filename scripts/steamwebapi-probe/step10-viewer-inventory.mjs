import { readFile } from "node:fs/promises";
import { call, saveArtifact, summary } from "./client.mjs";
const wait = (ms) => new Promise((s) => setTimeout(s, ms));
const out = {};

/* Phase N: viewer / screenshot product — documented as available in every package. */
let r = await call("/steam/api/screenshot/usage", { bucket: "OTHER", label: "screenshot/usage" });
out.screenshotUsage = { status: r.status, body: r.json };
console.log(`screenshot/usage -> ${r.status}: ${JSON.stringify(r.json).slice(0, 320)}`);
await wait(31_000);

/* One render against a real inspect link taken from the shape sample. */
const shape = JSON.parse(await readFile("reports/steamwebapi-probe/step2-shape.json", "utf8"));
const inspect = shape.rows.find((x) => x.inspectlink)?.inspectlink;
r = await call("/steam/api/screenshot", {
  query: { url: inspect, width: 960, mode: "front", format: "base64" },
  bucket: "SCREENSHOT", label: "screenshot render",
});
out.screenshotRender = {
  status: r.status, bytes: r.bytes, durationMs: r.durationMs,
  // Never store the image itself, only whether one came back.
  returned: r.json?.status ?? null,
  isDataUri: typeof r.json?.image === "string" ? r.json.image.slice(0, 24) : null,
  jobPending: r.json?.job_id ? true : false,
  error: r.status !== 200 ? JSON.stringify(r.json).slice(0, 300) : null,
};
console.log(`screenshot render -> ${r.status} ${r.bytes}B ${r.durationMs}ms  ${JSON.stringify(out.screenshotRender).slice(0,260)}`);
await wait(31_000);

/* Phase O: what does /inventory carry that /items cannot? Public profile only. */
r = await call("/steam/api/inventory", {
  query: { steam_id: "76561198042843401", game: "cs2", parse: 1, limit: 3, state: "fallback", production: 1 },
  bucket: "OTHER", label: "inventory (public profile)",
});
const inv = Array.isArray(r.json) ? r.json : r.json?.data ?? [];
out.inventory = { status: r.status, bytes: r.bytes, rows: inv.length, error: r.status !== 200 ? JSON.stringify(r.json).slice(0,200) : null };
console.log(`\ninventory -> ${r.status} rows=${inv.length}`);
if (inv[0]) {
  const itemsFields = new Set(JSON.parse(await readFile("reports/steamwebapi-probe/universe-raw.json", "utf8"))[0] ? Object.keys(shape.rows[0]) : []);
  const invFields = Object.keys(inv[0]);
  const unique = invFields.filter((f) => !itemsFields.has(f));
  out.inventory.uniqueFields = unique;
  out.inventory.floatBlock = inv[0].float ?? null;
  console.log(`  fields unique to /inventory: ${unique.join(", ")}`);
  console.log(`  per-item float block: ${JSON.stringify(inv[0].float).slice(0, 300)}`);
}
await saveArtifact("docs/evidence/steamwebapi/viewer-and-inventory.json", out);
console.log("\nledger:", JSON.stringify(summary()));
