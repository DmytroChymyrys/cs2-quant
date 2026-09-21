/**
 * CLI wrapper around the production refresh lifecycle.
 *
 * The lifecycle itself lives in src/lib/derived-market/refresh-run.ts and is
 * shared with the cron endpoint, so there is exactly one implementation of the
 * derivation path and its guarantees. This file only parses arguments, sources
 * the asset universe from disk, writes the report file, and maps the outcome to
 * an exit code.
 */
import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  runRefresh,
  refreshSummary,
} from "../../src/lib/derived-market/refresh-run";

const { values: args } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    universe: { type: "string", default: "reports/collection-experiment.json" },
    "max-days": { type: "string" },
    /** Persist and validate, but leave the pointer where it is. */
    "no-activate": { type: "boolean", default: false },
    out: { type: "string" },
    note: { type: "string" },
    /** Run retention after the pointer has moved and been verified. */
    retain: { type: "boolean", default: false },
    /** Classify and report only; nothing is deleted. */
    "retain-dry-run": { type: "boolean", default: false },
    /** Repeatable. Snapshots the caller requires retention to keep. */
    protect: { type: "string", multiple: true, default: [] },
  },
});

const universe = JSON.parse(await readFile(args.universe!, "utf8"));
const outcome = await runRefresh({
  sourceUrl: process.env.MARKET_ANALYTICS_SOURCE_URL ?? "",
  assets: universe.assets as string[],
  from: args.from,
  to: args.to,
  maxDays: args["max-days"] ? Number(args["max-days"]) : undefined,
  noActivate: args["no-activate"],
  retain: args.retain,
  retainDryRun: args["retain-dry-run"],
  protect: args.protect,
  note: args.note,
});

const out =
  args.out ??
  `reports/derived-market/refresh-${new Date().toISOString().replaceAll(":", "-")}.json`;
try {
  await mkdir("reports/derived-market", { recursive: true });
  await writeFile(out, JSON.stringify(outcome, null, 2) + "\n");
  outcome.reportPath = out;
} catch {
  // A refresh that succeeded must not be reported as failed because the
  // operator's disk is full; the stdout line below remains authoritative.
}
console.info(JSON.stringify(refreshSummary(outcome)));
if (outcome.result === "FAILED") process.exitCode = 2;
else if (outcome.result === "REJECTED") process.exitCode = 1;
