import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import {
  compareRankings,
  researchGate,
  rankings,
  explore,
} from "../../src/lib/derived-market/exploratory";
import type { SnapshotExport } from "../../src/lib/derived-market/offline-snapshot";
const { values: a } = parseArgs({
  options: {
    input: { type: "string" },
    against: { type: "string" },
    out: { type: "string" },
    mode: { type: "string", default: "rank" },
    horizon: { type: "string", default: "1h" },
  },
});
if (
  !a.input ||
  !a.out ||
  !["rank", "explore", "compare"].includes(a.mode!) ||
  !["1h", "6h", "24h"].includes(a.horizon!)
)
  throw Error("EXPLICIT_INPUT_OUTPUT_AND_SUPPORTED_MODE_REQUIRED");
const data = JSON.parse(await readFile(a.input, "utf8")) as SnapshotExport;
researchGate(data);
const other =
  a.mode === "compare"
    ? (JSON.parse(await readFile(a.against ?? "", "utf8")) as SnapshotExport)
    : null;
if (other) {
  researchGate(other);
  if (other.evidence !== data.evidence)
    throw Error("CANNOT_MIX_SYNTHETIC_AND_OBSERVED_EVIDENCE");
}
const result = {
  evidence: data.evidence,
  snapshotId: data.snapshotId,
  scope: data.head.scope,
  method: data.head.method,
  generatedAt: new Date().toISOString(),
  mode: a.mode,
  warning:
    data.evidence === "SYNTHETIC"
      ? "SYNTHETIC TEST OUTPUT — NOT MARKET EVIDENCE"
      : "DESCRIPTIVE EXPLORATORY OUTPUT — NOT PRODUCT INTELLIGENCE",
  result: other
    ? compareRankings(data, other)
    : a.mode === "rank"
      ? rankings(data)
      : explore(
          data,
          { "1h": 12, "6h": 72, "24h": 288 }[a.horizon as "1h" | "6h" | "24h"],
        ),
};
await writeFile(a.out + ".json", JSON.stringify(result, null, 2) + "\n");
if (a.mode === "rank") {
  const rows = rankings(data).rows,
    keys = Object.keys(rows[0] ?? {}),
    cell = (v: unknown) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  await writeFile(
    a.out + ".csv",
    [
      "evidence,snapshotId," + keys.join(","),
      ...rows.map((r) =>
        [
          data.evidence,
          data.snapshotId,
          ...keys.map((k) => r[k as keyof typeof r]),
        ]
          .map(cell)
          .join(","),
      ),
    ].join("\n") + "\n",
  );
}
console.log(
  JSON.stringify({
    output: a.out + ".json",
    evidence: data.evidence,
    mode: a.mode,
  }),
);
