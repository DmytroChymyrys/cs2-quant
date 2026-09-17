// Explicit local-only demonstration data. Never run against an application database.
import { Pool } from "pg";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { sequence, uuid } from "./sequence";
const url = process.env.DERIVED_FIXTURE_URL;
if (
  !url ||
  new URL(url).hostname !== "127.0.0.1" ||
  new URL(url).pathname !== "/floatalpha_derived_fixture"
)
  throw new Error("LOCAL_FIXTURE_DATABASE_REQUIRED");
const pool = new Pool({ connectionString: url, max: 1 });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  if (
    (await c.query("select to_regclass('public.assets') as present")).rows[0]
      .present
  )
    throw new Error("FIXTURE_DATABASE_MUST_BE_EMPTY");
  await c.query(
    await readFile("drizzle/market/0000_initial_market_snapshots.sql", "utf8"),
  );
  await c.query(
    await readFile(
      "drizzle/market/0001_protect_observation_history.sql",
      "utf8",
    ),
  );
  const input = sequence(2016, 3, 400);
  for (let i = 0; i < 3; i++)
    await c.query(
      "insert into assets(id,market_hash_name,is_tracked) values($1,$2,true)",
      [uuid(100000 + i), input.scope.assets[i]],
    );
  for (let i = 0; i < input.runs.length; i += 500)
    await c.query(
      `insert into collector_runs(id,source,window_start,started_at,finished_at,status,claim_key,duration_ms,items_http_status,history_http_status,tracked_assets,items_matched,observations_inserted,metadata)
    select (r->>'id')::uuid,'SKINPORT',(r->>'window')::timestamptz,(r->>'startedAt')::timestamptz,(r->>'startedAt')::timestamptz+interval '6 seconds','SUCCESS','SKINPORT:'||(r->>'window'),6000,200,200,3,3,3,
    jsonb_build_object('historyFetch',jsonb_build_object('bodySha256',r->>'historyHash','bodyReceivedAt',r->>'historyFetchedAt')) from jsonb_array_elements($1::jsonb) r`,
      [JSON.stringify(input.runs.slice(i, i + 500))],
    );
  for (let i = 0; i < input.observations.length; i += 500)
    await c.query(
      `insert into market_observations(id,asset_id,source,collector_run_id,observed_at,currency,min_price,median_price,quantity,source_created_at,source_updated_at,raw_item_payload,raw_history_payload)
    select (r->>'id')::uuid,(r->>'assetId')::uuid,'SKINPORT',(r->>'runId')::uuid,(r->>'observedAt')::timestamptz,'USD',(r->>'minPrice')::numeric,(r->>'medianPrice')::numeric,(r->>'quantity')::int,(r->>'itemsSourceAt')::timestamptz,(r->>'itemsSourceAt')::timestamptz,'{}'::jsonb,r->'history' from jsonb_array_elements($1::jsonb) r`,
      [JSON.stringify(input.observations.slice(i, i + 500))],
    );
  await c.query("COMMIT");
  await mkdir("reports/derived-market", { recursive: true });
  await writeFile(
    "reports/derived-market/fixture-universe.json",
    JSON.stringify(
      { evidenceType: "SYNTHETIC LOCAL FIXTURE", ...input.scope },
      null,
      2,
    ) + "\n",
  );
  console.info(
    "Seeded 2016 synthetic runs / 6048 observations in the isolated fixture database.",
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
