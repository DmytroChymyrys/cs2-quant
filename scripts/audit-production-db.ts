import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { sql } from 'drizzle-orm';
import { database } from '../src/lib/db';
const db=database();
const [migrationResult, tables, indexes, triggers, tracked, claims] = await Promise.all([
 db.execute(sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at`),
 db.execute(sql`select table_name,count(*)::int as columns from information_schema.columns where table_schema='public' and table_name in ('assets','asset_source_mappings','collector_runs','market_observations') group by table_name order by table_name`),
 db.execute(sql`select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname`),
 db.execute(sql`select tgname,tgenabled,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='market_observations'::regclass and not tgisinternal`),
 db.execute(sql`select a.market_hash_name,m.source_market_hash_name from assets a left join asset_source_mappings m on m.asset_id=a.id and m.source='SKINPORT' where a.is_tracked order by a.market_hash_name`),
 db.execute(sql`select r.id,r.window_start,r.started_at,r.status,r.tracked_assets,r.items_matched,r.items_missing,r.observations_inserted,r.duration_ms,count(o.id)::int as actual_observations from collector_runs r left join market_observations o on o.collector_run_id=r.id where r.claim_key is not null group by r.id order by r.started_at desc limit 10`),
]);
const local=readMigrationFiles({migrationsFolder:'./drizzle'});
const approved=JSON.parse(await readFile('config/tracked-assets.json','utf8')) as {marketHashName:string}[];
const issues:string[]=[];
if(local.length!==migrationResult.rows.length||local.some((m,i)=>m.hash!==migrationResult.rows[i]?.hash||m.folderMillis!==Number(migrationResult.rows[i]?.created_at)))issues.push('Migration journal differs from checked-in migrations');
if(tables.rows.length!==4)issues.push('Missing application tables');
if(!triggers.rows.some(t=>t.tgname==='observations_append_only'&&t.tgenabled==='O'))issues.push('Append-only trigger missing or disabled');
if(tracked.rows.length!==100||tracked.rows.some(a=>a.market_hash_name!==a.source_market_hash_name||!approved.some(p=>p.marketHashName===a.market_hash_name)))issues.push('Tracked universe or source mappings differ');
for(const name of ['observations_run_asset','mapping_asset_source','mapping_source_name','mapping_source_id','observations_asset_source_time','observations_source_time','runs_source_started'])if(!indexes.rows.some(i=>i.indexname===name))issues.push(`Missing index: ${name}`);
if(!indexes.rows.some(i=>i.tablename==='collector_runs'&&String(i.indexdef).includes('UNIQUE')&&String(i.indexdef).includes('(claim_key)')))issues.push('Missing unique window claim');
const report={checkedAt:new Date().toISOString(),issues,migrations:migrationResult.rows,tables:tables.rows,indexes:indexes.rows,triggers:triggers.rows,trackedAssets:tracked.rows.length,recentClaimedRuns:claims.rows};
await writeFile('reports/production-db-audit.json',JSON.stringify(report,null,2)+'\n');
console.info(JSON.stringify({issues,migrations:local.length,trackedAssets:tracked.rows.length,recentClaimedRuns:claims.rows},null,2));
if(issues.length)process.exitCode=1;
