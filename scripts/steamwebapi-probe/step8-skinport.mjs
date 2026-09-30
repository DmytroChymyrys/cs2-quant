import { call, saveArtifact, summary } from "./client.mjs";
import { writeFile } from "node:fs/promises";

/* What did the probe actually cost, and under which endpoint names? */
const acc = await call("/account/me", { bucket: "OTHER", label: "account/me (post-probe)" });
const a = acc.json ?? {};
console.log(`usage: minute=${a.minute} hour=${a.hour} today=${a.today} month=${a.month}`);
const spend = new Map();
for (const e of a.last100 ?? []) spend.set(e.endpoint, (spend.get(e.endpoint) ?? 0) + (e.credit ?? 0));
console.log("credits by endpoint (last100):", [...spend.entries()].map(([k, v]) => `${k}=${v}`).join(" "));
console.log("provider status:", JSON.stringify(a.steamwebapistatus));

await new Promise((s) => setTimeout(s, 31_000));

/* The whole Skinport mirror in one call — this is what Phase H needs. */
const r = await call("/market/skinport/prices", {
  bucket: "OTHER", label: "market/skinport/prices (all)", keepRaw: true,
});
console.log(`\nskinport mirror: status=${r.status} bytes=${r.bytes} duration=${r.durationMs}ms`);
const rows = Array.isArray(r.json) ? r.json : r.json?.data ?? [];
console.log(`rows=${rows.length}`);
if (rows.length) {
  const dates = rows.map((x) => x.createdat).filter(Boolean).sort();
  const byDate = new Map();
  for (const d of dates) byDate.set(d.slice(0, 10), (byDate.get(d.slice(0, 10)) ?? 0) + 1);
  console.log("createdat distribution:", [...byDate.entries()].sort().map(([k, v]) => `${k}:${v}`).join("  "));
  console.log("sample:", JSON.stringify(rows[0]));
  const q = rows.filter((x) => typeof x.quantity === "number");
  console.log(`quantity present=${q.length}  price present=${rows.filter((x)=>typeof x.price==="number").length}`);
}
await writeFile("reports/steamwebapi-probe/skinport-mirror.json", r.raw ?? "");
await saveArtifact("docs/evidence/steamwebapi/skinport-mirror-summary.json", {
  status: r.status, rows: rows.length, bytes: r.bytes,
  createdatDistribution: Object.fromEntries((() => { const m = new Map(); for (const x of rows) { const d = String(x.createdat ?? "").slice(0,10); m.set(d, (m.get(d) ?? 0) + 1); } return m; })()),
  sample: rows.slice(0, 3),
});
console.log("\nledger:", JSON.stringify(summary()));
