import "dotenv/config";
import { Pool } from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  STEP,
  validateScope,
  DEFAULT_SCOPE_DAYS,
  MAX_SCOPE_DAYS,
} from "../../src/lib/derived-market/model";
import { derive } from "../../src/lib/derived-market/features";
import { makeReport } from "../../src/lib/derived-market/report";
import {
  loadSource,
  storageMeasurement,
} from "../../src/lib/derived-market/source";
import { persistSnapshot } from "../../src/lib/derived-market/store";
const { values: args } = parseArgs({
  options: {
    mode: { type: "string", default: "report" },
    from: { type: "string" },
    to: { type: "string" },
    universe: { type: "string", default: "reports/collection-experiment.json" },
    out: { type: "string" },
    persist: { type: "boolean", default: false },
    "max-days": { type: "string" },
  },
});
const closed = new Date(Math.floor(Date.now() / STEP) * STEP).toISOString();
const sourceUrl = process.env.MARKET_ANALYTICS_SOURCE_URL;
const targetUrl = process.env.DERIVED_MARKET_DATABASE_URL;
let source: Pool | undefined, target: Pool | undefined;
try {
  if (!sourceUrl)
    throw new Error("EXPLICIT_MARKET_ANALYTICS_SOURCE_URL_REQUIRED");
  if (args.persist && !targetUrl)
    throw new Error("EXPLICIT_DERIVED_MARKET_DATABASE_URL_REQUIRED");
  if (
    args.persist &&
    new URL(sourceUrl).host === new URL(targetUrl!).host &&
    new URL(sourceUrl).pathname === new URL(targetUrl!).pathname
  )
    throw new Error("DERIVED_TARGET_MUST_BE_SEPARATE_DATABASE");
  if (!["report", "health", "storage"].includes(args.mode!))
    throw new Error("INVALID_MODE");
  // Longer scopes are for the controlled research snapshot and must be asked for
  // explicitly; the product default stays at seven days.
  const maxDays = args["max-days"]
    ? Number(args["max-days"])
    : DEFAULT_SCOPE_DAYS;
  if (!Number.isInteger(maxDays) || maxDays < 1 || maxDays > MAX_SCOPE_DAYS)
    throw new Error(
      `MAX_DAYS_MUST_BE_AN_INTEGER_BETWEEN_1_AND_${MAX_SCOPE_DAYS}`,
    );
  const output =
    args.out ??
    `reports/derived-market/${args.mode}-${new Date().toISOString().replaceAll(":", "-")}`;
  await mkdir(dirname(output), { recursive: true });
  source = new Pool({
    connectionString: sourceUrl,
    max: 1,
    connectionTimeoutMillis: 10000,
    statement_timeout: 60000,
    options: "-c default_transaction_read_only=on",
  });
  const client = await source.connect();
  let input, storage;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    storage = await storageMeasurement(client);
    if (args.mode !== "storage") {
      const universe = JSON.parse(await readFile(args.universe!, "utf8"));
      if (args.mode === "report" && (!args.from || !args.to))
        throw new Error("REPORT_REQUIRES_EXPLICIT_FROM_AND_TO");
      const to = args.to ?? closed;
      const from =
        args.from ?? new Date(Date.parse(to) - 86400000).toISOString();
      const scope = {
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        assets: universe.assets as string[],
      };
      validateScope(scope, maxDays);
      if (Date.parse(scope.to) > Date.parse(closed))
        throw new Error("REPORT_END_NOT_YET_CLOSED");
      input = await loadSource(client, scope, maxDays);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!input) {
    await writeFile(`${output}.json`, JSON.stringify(storage, null, 2) + "\n");
    console.info(
      JSON.stringify({ output: `${output}.json`, kind: "storage measurement" }),
    );
  } else {
    const derived = derive(input, maxDays),
      report = makeReport(input, derived, maxDays);
    const artifact = {
      ...report,
      generatedAt: new Date().toISOString(),
      storageAtQueryTime: storage,
    };
    await writeFile(`${output}.json`, JSON.stringify(artifact, null, 2) + "\n");
    await writeFile(
      `${output}.md`,
      `# Derived market report\n\n${report.operationalStatus} · ${input.scope.from} ≤ window < ${input.scope.to}\n\nDescriptive only. Full structured results:\n\n\`\`\`json\n${JSON.stringify(artifact, null, 2)}\n\`\`\`\n`,
    );
    if (args.persist) {
      if (report.operationalFailures.includes("DUPLICATE_INTEGRITY"))
        throw new Error(
          "REFUSING_TO_PUBLISH_AMBIGUOUS_DUPLICATES_REPORT_PRESERVED",
        );
      target = new Pool({
        connectionString: targetUrl,
        max: 1,
        connectionTimeoutMillis: 10000,
      });
      const writer = await target.connect();
      try {
        await writer.query("BEGIN");
        await persistSnapshot(writer, derived, report);
        await writer.query("COMMIT");
      } catch (error) {
        await writer.query("ROLLBACK");
        throw error;
      } finally {
        writer.release();
      }
    }
    console.info(
      JSON.stringify({
        output: `${output}.json`,
        status: report.operationalStatus,
        failures: report.operationalFailures,
        snapshotId: derived.snapshotId,
        featureRows: derived.features.length,
        historyVersions: derived.historyVersions.length,
        persisted: args.persist,
      }),
    );
    if (args.mode === "health" && report.operationalStatus === "FAIL")
      process.exitCode = 1;
  }
} catch (error) {
  // Safe bounded error codes only, never raw driver details/connection strings.
  const message =
    error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "ANALYTICS_COMMAND_FAILED";
  console.error(message);
  process.exitCode = 2;
} finally {
  await source?.end();
  await target?.end();
}
