import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { database } from '../src/lib/db';
import { sql } from 'drizzle-orm';
const origin='https://cs2-quant.vercel.app', url=`${origin}/api/internal/collect/skinport`;
const apiKey=process.env.CRON_JOB_ORG_API_KEY, secret=process.env.CRON_SECRET;
if(!apiKey||!secret) throw new Error('MISSING_SCHEDULER_CREDENTIAL');
const inspection=JSON.parse(await readFile('reports/poc-100-manual-inspection.json','utf8'));
if(inspection.issues.length||inspection.observationCount!==100||inspection.run.status!=='SUCCESS'||inspection.duplicate.error_code!=='DUPLICATE_WINDOW') throw new Error('MANUAL_ACCEPTANCE_REQUIRED');
async function api(path:string,method='GET',body?:unknown) {
  const response=await fetch(`https://api.cron-job.org${path}`,{method,headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`CRON_API_HTTP_${response.status}`);
  const text=await response.text();return text?JSON.parse(text):{};
}
const mode=process.argv[2];
if(mode==='prepare') {
  const existing=await api('/jobs');
  if(existing.someFailed) throw new Error('INCOMPLETE_JOB_LIST');
  const jobs=existing.jobs.filter((j:{url:string})=>j.url===url);
  if(jobs.length>1||jobs.some((j:{enabled:boolean})=>j.enabled)) throw new Error('EXISTING_ENABLED_OR_DUPLICATE_SCHEDULE');
  const job={title:'cs2-quant — Skinport collection every five minutes',url,enabled:false,saveResponses:true,requestMethod:1,requestTimeout:60,redirectSuccess:false,
    schedule:{timezone:'UTC',expiresAt:0,hours:[-1],mdays:[-1],minutes:Array.from({length:12},(_,i)=>i*5),months:[-1],wdays:[-1]},
    extendedData:{headers:{Authorization:`Bearer ${secret}`},body:''},notification:{onFailure:false,onSuccess:false,onDisable:false,onSslCertExpiry:false}};
  const jobId=jobs[0]?.jobId??(await api('/jobs','PUT',{job})).jobId;
  if(jobs.length) await api(`/jobs/${jobId}`,'PATCH',{job});
  const startedAt=new Date(Math.ceil((Date.now()+180000)/300000)*300000).toISOString();
  const assets=JSON.parse(await readFile('config/tracked-assets.json','utf8')).map((a:{marketHashName:string})=>a.marketHashName);
  const baseline=await database().execute(sql`select pg_total_relation_size('market_observations')::text as "observationTableAndIndexesBytes", (select count(*)::int from market_observations) as "observationRows", pg_database_size(current_database())::text as "databaseBytes"`);
  await writeFile('reports/collection-experiment.json',JSON.stringify({project:'cs2-quant',jobId,url,status:'PREPARED_DISABLED',preparedAt:new Date().toISOString(),startedAt,reportDueAt:new Date(Date.parse(startedAt)+86400000).toISOString(),assets,databaseBaseline:baseline.rows[0]},null,2)+'\n');
  const env=await readFile('.env','utf8');
  await writeFile('.env',env.replace(/^COLLECTION_SCHEDULE_STARTED_AT=.*\n?/gm,'').trimEnd()+`\nCOLLECTION_SCHEDULE_STARTED_AT=${startedAt}\n`);
  console.info(JSON.stringify({jobId,status:'PREPARED_DISABLED',startedAt,enableNotBefore:new Date(Date.parse(startedAt)-300000+1000).toISOString()}));
} else if(mode==='enable') {
  const experiment=JSON.parse(await readFile('reports/collection-experiment.json','utf8'));
  if(Date.now()<Date.parse(experiment.startedAt)-300000+1000) throw new Error('TOO_EARLY_TO_ENABLE_WAIT_UNTIL_PREVIOUS_BUCKET');
  if(experiment.status!=='PREPARED_DISABLED'||Date.now()>=Date.parse(experiment.startedAt)-15000) throw new Error('START_TOO_CLOSE_OR_ALREADY_ENABLED');
  const response=await fetch(`${origin}/api/internal/data-health`,{headers:{Authorization:`Bearer ${secret}`}});
  if(!response.ok) throw new Error('DEPLOYED_HEALTH_FAILED');
  const health=await response.json();
  if(health.schedule?.startedAt!==experiment.startedAt||health.coverage.trackedAssets!==100||health.lastRun.status!=='SUCCESS'||health.lastRun.observations_inserted!==100) throw new Error('DEPLOYED_SCHEDULE_OR_COLLECTION_MISMATCH');
  const details=(await api(`/jobs/${experiment.jobId}`)).jobDetails;
  if(details.enabled||details.url!==url||details.requestMethod!==1||details.extendedData.headers.Authorization!==`Bearer ${secret}`||details.schedule.timezone!=='UTC'||JSON.stringify(details.schedule.minutes)!==JSON.stringify(Array.from({length:12},(_,i)=>i*5))) throw new Error('JOB_CONFIGURATION_MISMATCH');
  const enabledAt=new Date().toISOString();
  await api(`/jobs/${experiment.jobId}`,'PATCH',{job:{enabled:true}});
  // Persist enablement before readback so a failed verification cannot erase the fact of activation.
  Object.assign(experiment,{status:'ENABLED_PENDING_VERIFICATION',enabledAt});
  await writeFile('reports/collection-experiment.json',JSON.stringify(experiment,null,2)+'\n');
  const verified=(await api(`/jobs/${experiment.jobId}`)).jobDetails;
  const nextAt=verified.nextExecution?new Date(verified.nextExecution*1000).toISOString():null;
  if(!verified.enabled||nextAt!==experiment.startedAt) throw new Error('NEXT_EXECUTION_MISMATCH_INSPECT_SCHEDULE');
  Object.assign(experiment,{status:'ENABLED',verifiedAt:new Date().toISOString(),nextExecution:nextAt,schedule:verified.schedule,requestMethod:'POST',authorizationHeaderConfigured:true});
  await writeFile('reports/collection-experiment.json',JSON.stringify(experiment,null,2)+'\n');
  console.info(JSON.stringify({jobId:experiment.jobId,enabledAt,startedAt:experiment.startedAt,reportDueAt:experiment.reportDueAt,nextExecution:nextAt}));
} else throw new Error('Use prepare or enable');
