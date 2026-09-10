import "dotenv/config";
import { parseArgs } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  loadOfflineSnapshot,
  fingerprint,
  selectionContents,
} from "../../src/lib/derived-market/offline-snapshot";
import { reviewSnapshot } from "../../src/lib/derived-market/snapshot-review";
const { values: a } = parseArgs({
  options: {
    id: { type: "string" },
    evidence: { type: "string" },
    out: { type: "string" },
    export: { type: "string" },
    "select-reviewed": { type: "string" },
    "env-file": { type: "string" },
  },
});
const url = process.env.DERIVED_MARKET_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw Error("LOCAL_ANALYTICS_DATABASE_REQUIRED");
if (!a.id || !["SYNTHETIC", "OBSERVED"].includes(a.evidence ?? ""))
  throw Error("EXPLICIT_ID_AND_EVIDENCE_REQUIRED");
if (a["env-file"] && !a["select-reviewed"])
  throw Error("REVIEW_RECEIPT_REQUIRED");
const pool = new Pool({
    connectionString: url,
    max: 1,
    statement_timeout: 15000,
    options: "-c default_transaction_read_only=on",
  }),
  db = await pool.connect();
try {
  await db.query("begin isolation level repeatable read read only");
  const data = await loadOfflineSnapshot(
    db,
    a.id,
    a.evidence as "SYNTHETIC" | "OBSERVED",
  );
  await db.query("commit");
  const receipt = {
    format: "floatalpha-review-v1",
    evidence: data.evidence,
    snapshotId: data.snapshotId,
    fingerprint: fingerprint(data),
    ...reviewSnapshot(
      data.head,
      data.features,
      data.historyVersions,
      new Date().toISOString(),
    ),
  };
  if (a["select-reviewed"]) {
    const prior = JSON.parse(await readFile(a["select-reviewed"], "utf8"));
    if (
      prior.format !== receipt.format ||
      prior.snapshotId !== receipt.snapshotId ||
      prior.evidence !== receipt.evidence ||
      prior.fingerprint !== receipt.fingerprint
    )
      throw Error("REVIEW_DOES_NOT_MATCH_CANDIDATE");
    if (
      !a["env-file"] ||
      ![".env.local", ".env.snapshot.local"].includes(a["env-file"])
    )
      throw Error("EXPLICIT_LOCAL_ENV_FILE_REQUIRED");
    const path = resolve(a["env-file"]);
    const existing = await readFile(path, "utf8").catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return "";
        throw e;
      },
    );
    await writeFile(path, selectionContents(existing, data.snapshotId, url), {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        selected: data.snapshotId,
        localEnvFile: a["env-file"],
        evidence: data.evidence,
        note: "Explicit local selection only; reload the local server. No deployment.",
      }),
    );
  } else {
    if (!a.out) throw Error("REVIEW_OUTPUT_PATH_REQUIRED");
    await writeFile(a.out, JSON.stringify(receipt, null, 2) + "\n");
    if (a.export) await writeFile(a.export, JSON.stringify(data) + "\n");
    console.log(JSON.stringify(receipt, null, 2));
  }
} finally {
  db.release();
  await pool.end();
}
