import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const B='http://localhost:3420';
const D={viewport:{width:1440,height:1100}}, M=devices['iPhone 13'];
const R=[]; const rec=(n,p,d)=>{R.push({n,p,d});console.log(`${p?'OK  ':'FAIL'} ${n}${d?' :: '+d:''}`)};
const br=await chromium.launch();
const ASSETS={ 'AK-47 | Crane Flight':'Crane Flight', 'Kilowatt Case':'Kilowatt',
  'Glock-18 | Sand Dune':'Glock-18', 'Souvenir AWP | Dragon Lore':'Souvenir AWP' };

async function grab(ctxOpts,label,path){
  const c=await br.newContext(ctxOpts); const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(B+path,{waitUntil:'networkidle',timeout:60000}); await p.waitForTimeout(300);
  const txt=await p.evaluate(()=>document.body.innerText);
  const headers=await p.evaluate(()=>[...document.querySelectorAll('th')].map(t=>t.innerText.trim()));
  const firstRow=await p.evaluate(()=>{const r=document.querySelector('tbody tr');return r?[...r.querySelectorAll('td')].map(t=>t.innerText.trim()):[]});
  const story=await p.evaluate(()=>document.querySelector('.market-story')?.innerText?.trim()||null);
  const summary=await p.evaluate(()=>document.querySelector('.market-story-summary')?.innerText?.replace(/\n+/g,' | ')||null);
  const depths=await p.evaluate(()=>[...document.querySelectorAll('.depth')].slice(0,6).map(d=>({v:d.innerText.trim(),t:d.dataset.depth})));
  await p.screenshot({path:`qa/${label}.png`,fullPage:true});
  rec(`${label} no page errors`, errs.length===0, errs[0]||'');
  await c.close(); return {txt,headers,firstRow,story,summary,depths};
}

// 1. Horizon correctness across all three
for (const h of ['1h','6h','24h']) {
  const r=await grab(D,`h-${h}`,`/screener?preset=movers&horizon=${h}`);
  const hdr=r.headers.find(x=>/^listings\s*Δ/i.test(x));
  rec(`header says Listings Δ · ${h}`, (hdr||'').toLowerCase()===`listings Δ · ${h}`.toLowerCase(), hdr);
  rec(`${h} story line present`, !!r.story, r.story);
}
// values must differ between horizons for the same top asset
const a1=await grab(D,'hv-1h','/screener?q=Crane%20Flight&horizon=1h');
const a24=await grab(D,'hv-24h','/screener?q=Crane%20Flight&horizon=24h');
rec('listings Δ value changes with horizon', a1.firstRow[4]!==a24.firstRow[4], `1h=${a1.firstRow[4]} 24h=${a24.firstRow[4]}`);
rec('story line changes with horizon', a1.story!==a24.story, `1h="${a1.story}" 24h="${a24.story}"`);

// 2. Basis
const bmin=await grab(D,'basis-min','/screener?q=Crane%20Flight&horizon=24h&basis=minimum');
const bmed=await grab(D,'basis-med','/screener?q=Crane%20Flight&horizon=24h&basis=median');
rec('story line reflects basis', bmin.story!==bmed.story, `min="${bmin.story}" median="${bmed.story}"`);
rec('median basis line starts Median', (bmed.story||'').startsWith('Median'), bmed.story);

// 3. Depth
const thin=await grab(D,'depth-thin','/screener?q=Sand%20Dune');
rec('thin depth flagged', /THIN DEPTH/.test(thin.txt), thin.depths.map(d=>`${d.v}:${d.t}`).join(' '));
rec('thin count still visible', /\b3\b/.test(thin.firstRow.join(' ')), thin.firstRow.join(' | '));
const deep=await grab(D,'depth-deep','/screener?q=Kilowatt');
rec('deep depth NOT flagged thin', !/THIN DEPTH/.test(deep.txt), deep.depths.map(d=>`${d.v}:${d.t}`).join(' '));

// 4. Availability
const gone=await grab(D,'unavailable','/screener?q=Souvenir%20AWP');
rec('non-ACTIVE still says no active listing', /No active listing observed/i.test(gone.txt));
rec('non-ACTIVE thin depth flagged', /THIN DEPTH/.test(gone.txt));

// 5. Asset Intelligence for all four
for (const [name,q] of Object.entries(ASSETS)) {
  const c=await br.newContext(D); const p=await c.newPage();
  await p.goto(`${B}/screener?q=${encodeURIComponent(q)}`,{waitUntil:'networkidle'});
  const href=await p.evaluate(()=>document.querySelector('a[href^="/asset/"]')?.getAttribute('href'));
  await c.close();
  if(!href){rec(`${name} asset link`,false);continue}
  const slug=name.replace(/[^a-z0-9]+/gi,'-').toLowerCase();
  const r=await grab(D,`asset-${slug}`,href);
  rec(`${name}: market story summary present`, !!r.summary, (r.summary||'').slice(0,150));
  rec(`${name}: no raw multi-thousand-second age on screen`, !/\b\d{4,}(\.\d+)?s\b/.test(r.txt.split('Exact:')[0]), (r.txt.match(/\b\d{4,}(\.\d+)?s\b/)||[''])[0]);
  await grab(M,`asset-${slug}-mobile`,href);
}

// 6. Mobile depth visibility without horizontal scroll
const mob=await grab(M,'mobile-screener','/screener?q=Sand%20Dune');
rec('mobile shows listing count in story line', /listing/.test(mob.story||''), mob.story);
const mobK=await grab(M,'mobile-kilowatt','/screener?q=Kilowatt&horizon=24h');
rec('mobile deep asset shows count', /listings/.test(mobK.story||''), mobK.story);

// 7. Terminal caption
const term=await grab(D,'terminal','/terminal');
rec('terminal caption shows 12.5 not 50', /Activity ≥ 12\.5 \/ 100/.test(term.txt) && !/Activity ≥ 50/.test(term.txt),
  (term.txt.match(/Activity ≥ [\d.]+ \/ 100/)||[''])[0]);

await br.close();
fs.writeFileSync('qa/results.json',JSON.stringify(R,null,1));
const f=R.filter(x=>!x.p);
console.log(`\n${R.length-f.length}/${R.length} passed`);
if(f.length){console.log('FAILED:');for(const x of f)console.log(' -',x.n,x.d||'')}
