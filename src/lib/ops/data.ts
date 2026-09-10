import "server-only";
import { sql } from "drizzle-orm";
import { requireAdmin } from "./auth";
import { productDatabase } from "../product/db";
import { database } from "../db";
import { catalogDatabase } from "../catalog/db";
import { assetImageState } from "../asset-images/service";
import { readImageRecord } from "../asset-images/store";
import { sourceConfig } from "../config";
import { opsQuery, watchedAssetsQuery } from "./queries";
import type { OpsSection } from "./config";
export type OpsRow = Record<string, unknown>;
export type OpsTable = {
  title: string;
  rows: OpsRow[];
  unavailable?: boolean;
  durationMs: number;
};
async function read(
  title: string,
  action: () => Promise<OpsRow[]>,
): Promise<OpsTable> {
  const start = performance.now();
  try {
    return {
      title,
      rows: await action(),
      durationMs: Math.round(performance.now() - start),
    };
  } catch {
    return {
      title,
      rows: [],
      unavailable: true,
      durationMs: Math.round(performance.now() - start),
    };
  }
}
export async function readOps(
  section: OpsSection,
  days: number,
  search = "",
  page = 1,
) {
  await requireAdmin(); // Also protects direct DAL callers, independently of pages/API.
  if (section !== "system") {
    const tables = [
      await read(
        section,
        async () =>
          (
            await productDatabase().transaction(async (tx) => {
              await tx.execute(sql`set local statement_timeout='5000ms'`);
              return tx.execute(opsQuery(section, days, search, page));
            })
          ).rows,
      ),
    ];
    if (section === "product")
      tables.push(
        await read(
          "Most watched assets · current",
          async () =>
            (
              await productDatabase().transaction(async (tx) => {
                await tx.execute(sql`set local statement_timeout='5000ms'`);
                return tx.execute(watchedAssetsQuery);
              })
            ).rows,
        ),
      );
    return tables;
  }
  return Promise.all([
    read(
      "Collectors · latest 20 runs in 30 days",
      async () =>
        (
          await database().execute(sql`
      select source as "Provider",status as "Status",started_at as "Started (UTC)",finished_at as "Finished (UTC)",
      duration_ms as "Duration ms",error_code as "Error code",observations_inserted as "Inserted",items_missing as "Missing"
      from collector_runs where started_at >= now()-interval '30 days' and claim_key is not null
      order by started_at desc limit 20`)
        ).rows,
    ),
    read(
      "Latest successful / failed collector runs · 30 days",
      async () =>
        (
          await database().execute(sql`
      select distinct on (source,status) source as "Provider",status as "Status",started_at as "Started (UTC)",error_code as "Error code"
      from collector_runs where started_at>=now()-interval '30 days' and claim_key is not null and status in ('SUCCESS','FAILED')
      order by source,status,started_at desc limit 20`)
        ).rows,
    ),
    read(
      "Observation freshness",
      async () =>
        (
          await database().execute(sql`
      select count(*)::int as "Tracked assets",count(*) filter(where o.observed_at is null or
      o.observed_at < now()-${sourceConfig().SOURCE_STALE_AFTER_MINUTES} * interval '1 minute')::int as "Stale / missing observations",
      max(o.observed_at) as "Latest observation (UTC)" from assets a left join lateral
      (select observed_at from market_observations where asset_id=a.id and source='SKINPORT' order by observed_at desc limit 1) o on true where a.is_tracked`)
        ).rows,
    ),
    read(
      "Canonical catalog",
      async () =>
        (
          await catalogDatabase().query(`select
      (select count(*)::int from canonical_asset_catalog where deprecated_at is null) as "Active catalog records",
      (select max(finished_at) from catalog_sync_runs) as "Last committed sync (UTC)",
      (select count(*)::int from asset_media m join canonical_asset_catalog c using(catalog_asset_id) where c.deprecated_at is null and m.status='AVAILABLE') as "Available media",
      (select count(*)::int from asset_media m join canonical_asset_catalog c using(catalog_asset_id) where c.deprecated_at is null and m.status='MISSING') as "Missing media",
      (select count(*)::int from asset_media m join canonical_asset_catalog c using(catalog_asset_id) where c.deprecated_at is null and m.status='UNVERIFIED') as "Unverified media",
      (select count(*)::int from asset_media m join canonical_asset_catalog c using(catalog_asset_id) where c.deprecated_at is null and m.status='INVALID') as "Invalid media"`)
        ).rows,
    ),
    read("Tracked catalog mapping coverage", async () => {
      const tracked = (
        await database().execute(
          sql`select id,market_hash_name from assets where is_tracked limit 10001`,
        )
      ).rows;
      if (tracked.length > 10000) throw new Error("TRACKED_LIMIT");
      return (
        await catalogDatabase().query(
          `with tracked as (select * from jsonb_to_recordset($1::jsonb) as t(id uuid,market_hash_name text))
        select count(*)::int as "Tracked assets",count(*) filter(where m.status='EXACT' and m.market_hash_name=t.market_hash_name)::int as "Exact mappings",
        count(*) filter(where m.status='EXACT' and m.market_hash_name=t.market_hash_name and a.status='AVAILABLE')::int as "Available tracked media"
        from tracked t left join asset_catalog_mappings m on m.asset_id=t.id left join asset_media a on a.catalog_asset_id=m.catalog_asset_id`,
          [JSON.stringify(tracked)],
        )
      ).rows;
    }),
    read("Image provider · persisted health only", async () => {
      const state = await assetImageState();
      const health = await readImageRecord("health");
      return [
        {
          "Configured enabled": state.configuredEnabled,
          "Effective enabled": state.effectiveEnabled,
          "Effective status": state.status,
          "Persisted provider health": health?.value.status ?? "UNAVAILABLE",
          "Last check (UTC)": health?.value.checkedAt ?? null,
          "Health expiry (UTC)": health?.expires_at ?? null,
          "Failed probes": health?.value.failureCount ?? null,
        },
      ];
    }),
  ]);
}
