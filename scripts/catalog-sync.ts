import env from "@next/env";
import { Pool } from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadCatalogSource, manifest } from "../src/lib/catalog/source";
import { normalizeDataset } from "../src/lib/catalog/normalize";
import { duplicates, reconcile } from "../src/lib/catalog/reconcile";
import { synchronizeCatalog } from "../src/lib/catalog/store";
import { inspectMedia } from "../src/lib/catalog/media";
import type {
  CatalogRecord,
  Diagnostic,
  TrackedAsset,
} from "../src/lib/catalog/model";
env.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
const { values } = parseArgs({
  options: {
    "source-dir": { type: "string" },
    "tracked-file": { type: "string" },
    report: { type: "string", default: "reports/catalog/reconciliation.json" },
    "verify-tracked": { type: "boolean", default: false },
  },
});
if (!process.env.CATALOG_DATABASE_URL)
  throw new Error(
    "Set explicit CATALOG_DATABASE_URL; no market database write fallback.",
  );
const snapshot = await loadCatalogSource(values["source-dir"]);
const records: CatalogRecord[] = [],
  diagnostics: Diagnostic[] = [];
for (const [dataset, source] of snapshot) {
  const result = normalizeDataset(dataset, source);
  records.push(...result.records);
  diagnostics.push(...result.diagnostics);
}
const duplicate = duplicates(records);
const invalid =
  [...snapshot.values()].reduce((n, rows) => n + rows.length, 0) -
  records.length;
await mkdir(dirname(values.report!), { recursive: true });
if (
  duplicate.sourceIds.length ||
  diagnostics.some((d) => d.code === "DUPLICATE_SOURCE_ID") ||
  manifest.datasets.some((d) => !records.some((r) => r.dataset === d.name)) ||
  invalid > Math.max(10, records.length * 0.01)
) {
  await writeFile(
    values.report!,
    JSON.stringify(
      { status: "STOPPED_UNRELIABLE_SOURCE", diagnostics, duplicate },
      null,
      2,
    ),
  );
  throw new Error("UNRELIABLE_SOURCE; inspect report before catalog writes");
}
let trackedInput: unknown;
if (values["tracked-file"])
  trackedInput = JSON.parse(await readFile(values["tracked-file"], "utf8"));
else {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "DATABASE_URL or --tracked-file required for identity reconciliation",
    );
  const market = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });
  try {
    await market.query("BEGIN READ ONLY");
    trackedInput = (
      await market.query(
        "SELECT id as asset_id, market_hash_name FROM assets WHERE is_tracked ORDER BY market_hash_name",
      )
    ).rows;
    await market.query("COMMIT");
  } finally {
    await market.end();
  }
}
const tracked: TrackedAsset[] = z
  .array(z.object({ asset_id: z.uuid(), market_hash_name: z.string().min(1) }))
  .parse(trackedInput);
if (new Set(tracked.map((r) => r.asset_id)).size !== tracked.length)
  throw new Error("DUPLICATE_FLOATALPHA_ASSET_ID");
const mappings = reconcile(tracked, records);
const pool = new Pool({
  connectionString: process.env.CATALOG_DATABASE_URL,
  max: 1,
});
const client = await pool.connect();
const query = (text: string, params?: unknown[]) => client.query(text, params);
try {
  await query("BEGIN");
  await query("SELECT pg_advisory_xact_lock(730, 1)");
  const counts = await synchronizeCatalog(
    query,
    records,
    mappings,
    manifest.commit,
    new Date().toISOString(),
    manifest,
  );
  await query("COMMIT");
  // Slow media inspection happens after atomic identity/catalog reconciliation.
  // Only the tracked subset is inspected; the entire artwork corpus is not downloaded.
  if (values["verify-tracked"]) {
    const pending = await query(
      `SELECT DISTINCT m.catalog_asset_id,m.source_url FROM asset_media m JOIN asset_catalog_mappings a USING(catalog_asset_id)
      WHERE a.asset_id=ANY($1::uuid[]) AND a.status='EXACT' AND m.source_url IS NOT NULL AND
      (m.last_verified_at IS NULL OR m.last_verified_at < now()-interval '7 days')`,
      [tracked.map((a) => a.asset_id)],
    );
    let cursor = 0;
    const inspections = await Promise.allSettled(
      Array.from({ length: 3 }, async () => {
        while (cursor < pending.rows.length) {
          const row = pending.rows[cursor++];
          const media = await inspectMedia(row.source_url);
          await query(
            `UPDATE asset_media SET status=$2,width=$3,height=$4,content_type=$5,content_hash=$6,alpha_bounds=$7::jsonb,
          verification_error=$8,last_verified_at=now(),served_url=CASE WHEN $2 IN ('MISSING','INVALID') THEN NULL ELSE source_url END
          WHERE catalog_asset_id=$1 AND source_url=$9`,
            [
              row.catalog_asset_id,
              media.status,
              media.width,
              media.height,
              media.contentType,
              media.contentHash,
              JSON.stringify(media.alphaBounds),
              media.error,
              row.source_url,
            ],
          );
        }
      }),
    );
    if (inspections.some((result) => result.status === "rejected"))
      throw new Error("MEDIA_INSPECTION_PERSISTENCE_FAILED");
    console.info(`Inspected ${pending.rows.length} tracked media records.`);
  }
  const mediaRows = (
    await query(
      "SELECT m.catalog_asset_id,m.status,m.served_url,m.width,m.height,m.verification_error FROM asset_media m JOIN canonical_asset_catalog c USING(catalog_asset_id) WHERE c.deprecated_at IS NULL",
    )
  ).rows;
  const mediaById = new Map(mediaRows.map((r) => [r.catalog_asset_id, r]));
  const reconciled = mappings.map((m) => ({
    ...m,
    withMedia: Boolean(
      m.catalogAssetId && mediaById.get(m.catalogAssetId)?.served_url,
    ),
    mediaStatus: m.catalogAssetId
      ? mediaById.get(m.catalogAssetId)?.status
      : null,
  }));
  const report = {
    revision: manifest.commit,
    normalizerVersion: records[0]?.normalizerVersion,
    sourceRecords: [...snapshot.values()].reduce(
      (n, rows) => n + rows.length,
      0,
    ),
    normalizedRecords: records.length,
    datasets: manifest.datasets.map((d) => ({
      ...d,
      normalized: records.filter((r) => r.dataset === d.name).length,
    })),
    byAssetType: Object.fromEntries(
      [...new Set(records.map((r) => r.assetType))]
        .sort()
        .map((t) => [t, records.filter((r) => r.assetType === t).length]),
    ),
    ...counts,
    invalid,
    ambiguous: duplicate.marketNames.length,
    duplicateSourceIds: duplicate.sourceIds,
    duplicateMarketNames: duplicate.marketNames,
    diagnostics,
    media: {
      withUrl: mediaRows.filter((m) => m.served_url).length,
      withoutUrl: mediaRows.filter((m) => !m.served_url).length,
      byStatus: Object.fromEntries(
        ["AVAILABLE", "MISSING", "INVALID", "UNVERIFIED"].map((s) => [
          s,
          mediaRows.filter((m) => m.status === s).length,
        ]),
      ),
    },
    tracked: {
      total: tracked.length,
      exact: reconciled.filter((m) => m.status === "EXACT").length,
      missing: reconciled.filter((m) => m.status === "MISSING").length,
      ambiguous: reconciled.filter((m) => m.status === "AMBIGUOUS").length,
      withMedia: reconciled.filter((m) => m.withMedia).length,
      withoutMedia: reconciled.filter((m) => !m.withMedia).length,
      records: reconciled,
    },
  };
  await writeFile(values.report!, JSON.stringify(report, null, 2) + "\n");
  console.info(
    JSON.stringify(
      {
        ...counts,
        normalized: records.length,
        invalid,
        ambiguous: duplicate.marketNames.length,
        tracked: { ...report.tracked, records: undefined },
        report: values.report,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
