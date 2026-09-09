import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { database } from '../src/lib/db';

// Read-only experiment report. An early invocation is explicitly labelled interim.
const experiment = JSON.parse(await readFile(process.argv[2] ?? 'reports/collection-experiment.json', 'utf8'));
const start = Date.parse(experiment.startedAt), end = start + 86400000;
if (!Number.isFinite(start) || start % 300000) throw new Error('INVALID_EXPERIMENT_START');
const now = Date.now(), through = Math.max(start, Math.min(end, Math.floor(now / 300000) * 300000));
const fromIso = new Date(start).toISOString(), throughIso = new Date(through).toISOString();
const db = database();
const [runsResult, observationResult, sizesResult, staleResult] = await Promise.all([
  db.execute(sql`select * from collector_runs where source='SKINPORT' and claim_key is not null and window_start>=${fromIso}::timestamptz and window_start<${throughIso}::timestamptz order by window_start`),
  db.execute(sql`select a.market_hash_name, (select jsonb_object_agg(key, case when value='null'::jsonb then value else to_jsonb(value#>>'{}') end) from jsonb_each(to_jsonb(o)-'raw_item_payload'-'raw_history_payload')) as observation,
    (o.raw_item_payload->>'market_hash_name'=a.market_hash_name and o.raw_item_payload->>'version' is null
    and (o.raw_history_payload is null or (o.raw_history_payload->>'market_hash_name'=a.market_hash_name and o.raw_history_payload->>'version' is null))) as identity_valid
    from market_observations o join assets a on a.id=o.asset_id join collector_runs r on r.id=o.collector_run_id
    where r.source='SKINPORT' and r.claim_key is not null and r.window_start>=${fromIso}::timestamptz and r.window_start<${throughIso}::timestamptz order by r.window_start,a.market_hash_name`),
  db.execute(sql`select relname as name, pg_table_size(oid)::text as "tableBytes", pg_indexes_size(oid)::text as "indexBytes", pg_total_relation_size(oid)::text as "totalBytes"
    from pg_class where oid in ('assets'::regclass,'asset_source_mappings'::regclass,'collector_runs'::regclass,'market_observations'::regclass)`),
  db.execute(sql`select count(*)::int as occurrences from assets a cross join generate_series(${fromIso}::timestamptz,${throughIso}::timestamptz-interval '5 minutes',interval '5 minutes') w
    left join lateral (select observed_at from market_observations where source='SKINPORT' and asset_id=a.id and observed_at<w+interval '5 minutes' order by observed_at desc limit 1) latest on true
    where a.market_hash_name in (select jsonb_array_elements_text(${JSON.stringify(experiment.assets)}::jsonb)) and (latest.observed_at is null or latest.observed_at<w+interval '5 minutes'-interval '15 minutes')`),
]);
type Row = Record<string, unknown>;
const runs = runsResult.rows as Row[], observations: Row[] = observationResult.rows.map(r => ({ ...(r.observation as Row), market_hash_name: r.market_hash_name, identity_valid:r.identity_valid }));
const time = (value: unknown) => Date.parse(String(value));
const distribution = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a,b)=>a-b);
  const percentile = (p:number) => { const index=(sorted.length-1)*p, lower=Math.floor(index); return sorted.length ? sorted[lower]+(sorted[Math.ceil(index)]-sorted[lower])*(index-lower) : null; };
  return { count:sorted.length, min:sorted[0]??null, average:sorted.length?sorted.reduce((a,b)=>a+b,0)/sorted.length:null, p50:percentile(.5), p95:percentile(.95), max:sorted.at(-1)??null };
};
const metadata = (run:Row) => run.metadata as Record<string, unknown>;
const fetches = (key:string): (Row & {run:Row})[] => runs.flatMap(r => { const f=metadata(r)[key] as Row|undefined; return f ? [{run:r,...f}] : []; });
const fetchMetrics = (key:string) => { const entries=fetches(key); return {
  httpBodyLatencyMs:distribution(entries.filter(f=>f.bodyReceivedAt).map(f=>time(f.bodyReceivedAt)-time(f.startedAt))),
  fetchAndValidationLatencyMs:distribution(entries.map(f=>time(f.finishedAt)-time(f.startedAt))),
  missingTimingRuns:runs.length-entries.length,
}; };
const expectedWindows = (through-start)/300000;
const claimed = new Set(runs.map(r=>time(r.window_start)));
const missingWindows = Array.from({length:expectedWindows},(_,i)=>start+i*300000).filter(w=>!claimed.has(w)).map(w=>new Date(w).toISOString());
const statuses = Object.fromEntries(['SUCCESS','PARTIAL','FAILED','RUNNING'].map(status=>[status,runs.filter(r=>r.status===status).length]));
const marketFields = ['suggested_price','min_price','max_price','mean_price','median_price','quantity'];
const historyFields = ['24h','7d','30d','90d'].flatMap(period=>['min','max','avg','median','volume'].map(stat=>`sales_${period}_${stat}`));
const nullFrequency = (fields:string[]) => Object.fromEntries(fields.map(field=> { const count=observations.filter(o=>o[field]===null).length;return [field,{count,denominator:observations.length,frequency:observations.length?count/observations.length:null}]; }));
const coverage = (experiment.assets as string[]).map(name=> {
  const rows=observations.filter(o=>o.market_hash_name===name);
  const distinctValues=new Set(rows.map(o=>JSON.stringify([...marketFields,...historyFields].map(field=>o[field])))).size;
  return {marketHashName:name,observations:rows.length,expected:expectedWindows,missing:Math.max(0,expectedWindows-rows.length),distinctValues,
    valueState:rows.length<2?'insufficient observations':distinctValues>1?'changed':'unchanged'};
});
const historyResponses=fetches('historyFetch').filter(f=>typeof f.bodySha256==='string');
let unchanged=0, contiguousComparisons=0, contiguousUnchanged=0, streak=1, longestStreak=historyResponses.length?1:0;
const changedAt:string[]=[];
for(let i=1;i<historyResponses.length;i++) {
  const previous=historyResponses[i-1],current=historyResponses[i],same=previous.bodySha256===current.bodySha256;
  if(same){unchanged++;streak++;}else{changedAt.push(new Date(time(current.run.window_start)).toISOString());streak=1;}
  longestStreak=Math.max(longestStreak,streak);
  if(time(current.run.window_start)-time(previous.run.window_start)===300000){contiguousComparisons++;if(same)contiguousUnchanged++;}
}
const upstreamErrors=runs.flatMap(r=>(metadata(r).upstreamErrors as Row[]|undefined)??[]);
const anomalies:string[]=[];
for(const r of runs) {
  if(r.tracked_assets!==100) anomalies.push(`${r.id}: tracked asset count ${r.tracked_assets}`);
  if(r.status!=='RUNNING'&&(r.finished_at===null||r.duration_ms===null)) anomalies.push(`${r.id}: missing final timing`);
  if(r.finished_at!==null && time(r.finished_at)-time(r.started_at)!==r.duration_ms) anomalies.push(`${r.id}: duration/timestamp mismatch`);
  if(Number(r.observations_inserted)!==observations.filter(o=>o.collector_run_id===r.id).length) anomalies.push(`${r.id}: inserted counter mismatch`);
}
for(const o of observations) {
  if(!o.identity_valid||o.currency!=='USD'||Number(o.quantity)<0||time(o.source_updated_at)>time(o.observed_at)) anomalies.push(`${o.id}: identity, currency, quantity, or future source timestamp anomaly`);
}
const totalRows=await db.execute(sql`select count(*)::int as count from market_observations`);
const table=sizesResult.rows.find(r=>r.name==='market_observations')!;
const report = {
  generatedAt:new Date(now).toISOString(), phase:now>=end?'24-hour report':'INTERIM — 24 hours have not elapsed', startedAt:fromIso,
  reportDueAt:new Date(end).toISOString(), throughExclusive:throughIso, expectedScheduledWindows:expectedWindows, actualClaimedWindows:claimed.size,
  statusCounts:statuses, successRate:runs.length?statuses.SUCCESS/runs.length:null, successRateOfExpectedWindows:expectedWindows?statuses.SUCCESS/expectedWindows:null,
  missingWindowCount:missingWindows.length, missingWindows,
  http429Count:runs.reduce((n,r)=>n+Number(r.items_http_status===429)+Number(r.history_http_status===429),0),
  upstream5xxCount:runs.reduce((n,r)=>n+Number(Number(r.items_http_status)>=500)+Number(Number(r.history_http_status)>=500),0),
  malformedPayloadCount:upstreamErrors.filter(e=>['MALFORMED_JSON','INVALID_SCHEMA'].includes(String(e.code))).length,
  collectorDurationMs:distribution(runs.filter(r=>r.duration_ms!==null).map(r=>Number(r.duration_ms))),
  itemsFetch:fetchMetrics('itemsFetch'), historyFetch:fetchMetrics('historyFetch'), trackedAssetCoverage:coverage,
  missingItemOccurrences:runs.reduce((n,r)=>n+Number(r.items_missing),0),
  missingHistoryOccurrences:runs.reduce((n,r)=>n+((metadata(r).missingHistory as unknown[]|undefined)?.length??0),0),
  staleAssetOccurrences:staleResult.rows[0].occurrences, staleDefinition:'At each closed window end, latest observation absent or older than 15 minutes; includes missed windows.',
  observations:{expected:expectedWindows*100,inserted:observations.length,missing:expectedWindows*100-observations.length},
  database:{sizes:sizesResult.rows,totalObservationRows:totalRows.rows[0].count,approximateBytesPerObservation:Number(totalRows.rows[0].count)?Number(table.totalBytes)/Number(totalRows.rows[0].count):null,baseline:experiment.databaseBaseline??null,bytesDefinition:'Whole observation table including TOAST and indexes divided by all stored observations; allocation overhead and pre-experiment rows included.',actualNeonUsage:experiment.actualNeonUsage??{available:false,reason:'Provider metering has not been retrieved; database sizes are not billed Neon usage.'}},
  sourceFreshnessSeconds:distribution(observations.map(o=>(time(o.observed_at)-time(o.source_updated_at))/1000)),
  nullableMarketFields:nullFrequency(marketFields),nullableSalesHistoryFields:nullFrequency(historyFields),
  zeroSalesObservations:Object.fromEntries(['24h','7d','30d','90d'].map(p=>[p,observations.filter(o=>o[`sales_${p}_volume`]!==null && Number(o[`sales_${p}_volume`])===0).length])),
  assetsChanged:coverage.filter(a=>a.valueState==='changed').map(a=>a.marketHashName),assetsUnchanged:coverage.filter(a=>a.valueState==='unchanged').map(a=>a.marketHashName),
  historyPayloads:{hashedResponses:historyResponses.length,distinctHashes:new Set(historyResponses.map(f=>f.bodySha256)).size,comparisons:Math.max(0,historyResponses.length-1),unchangedComparisons:unchanged,unchangedFrequency:historyResponses.length>1?unchanged/(historyResponses.length-1):null,contiguousComparisons,contiguousUnchanged,longestIdenticalResponseStreak:longestStreak,changedAt,definition:'SHA-256 of complete decompressed UTF-8 History response, including untracked/versioned rows. Unchanged values remain valid observations.'},
  sourceSchemaAnomalies:anomalies,upstreamErrors,
};
const output = process.argv[3] ?? 'reports/experiment-latest';
await writeFile(`${output}.json`,JSON.stringify(report,null,2)+'\n');
await writeFile(`${output}.md`,`# cs2-quant collection experiment\n\n${report.phase}\n\n\`\`\`json\n${JSON.stringify(report,null,2)}\n\`\`\`\n`);
console.info(JSON.stringify({phase:report.phase,expectedWindows,claimedWindows:claimed.size,statuses,observations:report.observations,anomalies},null,2));
