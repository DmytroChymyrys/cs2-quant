import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const BASE = 'http://localhost:3401';
const SNAP = 'bc9d74a23d64214a6e3208bfbaecb83dc4f10fb367a9fa847ab185b950277c3b';
const results = [];
const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`); };

const browser = await chromium.launch();
async function shoot(ctxOpts, label, path, extra) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
  // Disclosures live in collapsed <details>; expand them so assertions see what
  // a user sees after opening them, and so screenshots show the evidence copy.
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
  await page.waitForTimeout(250);
  const text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `qa-shots/${label}.png`, fullPage: true });
  if (extra) await extra(page, text);
  record(`${label} renders without page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
  return text;
}

const DESKTOP = { viewport: { width: 1440, height: 1000 } };
const MOBILE = devices['iPhone 13'];

// --- Screener, desktop
let t = await shoot(DESKTOP, 'screener-desktop-1440', '/screener');
record('screener shows real data, not "not configured"', !/has not been configured/i.test(t));
record('screener shows no synthetic/demo banner', !/\b(demo|synthetic|fixture|sample data)\b/i.test(t), (t.match(/\b(demo|synthetic|fixture|sample data)\b/i) || [])[0] || '');
record('screener names minimum AND median price', /Minimum listing price/i.test(t) && /median listing price/i.test(t));
record('screener states evidence/provenance', /SKINPORT/i.test(t));
record('screener labels volatility EXPERIMENTAL', /EXPERIMENTAL/.test(t));
record('screener labels combined states descriptive', /descriptive market states, not signals/i.test(t));
record('screener discloses provisional thresholds', /provisional/i.test(t));

// --- Screener, mobile
await shoot(MOBILE, 'screener-mobile-390', '/screener');

// --- Preset with real counts: price rising + listings contracting
t = await shoot(DESKTOP, 'screener-rising-contracting-1440', '/screener?preset=risingContracting&horizon=24h');
record('combined-state preset returns rows', /listings/i.test(t) && !/No assets match/i.test(t), (t.match(/\d+ assets?/i) || [])[0] || '');

// --- Median basis
t = await shoot(DESKTOP, 'screener-median-basis-1440', '/screener?preset=movers&horizon=24h&basis=median');
record('median basis selectable and labelled', /Median listing price/i.test(t));

// --- Asset Intelligence: the delisted asset (availability semantics)
const derived = JSON.parse(fs.readFileSync('reports/post-7day-production/product-wiring-production.json', 'utf8'));
const gone = derived.nonActiveAssets[0];
t = await shoot(DESKTOP, 'asset-unavailable-desktop-1440', `/screener?q=${encodeURIComponent('Souvenir AWP')}`);
record('delisted asset findable in screener', /Dragon Lore/i.test(t));
record('availability surfaced as no-active-listing', /no active listing observed/i.test(t), (t.match(/no active listing[^.]*/i) || [])[0] || '');
record('last price not presented as actionable', /not currently actionable/i.test(t) || /last observed/i.test(t));

// --- Asset Intelligence detail page
const assetId = derived.sampleMovers[0] && derived.sampleMovers[0].name;
t = await shoot(DESKTOP, 'asset-detail-desktop-1440', `/screener?q=${encodeURIComponent('Kilowatt')}`);
record('thin/deep market shows listing depth', /listings/i.test(t));

// --- Empty / unavailable state
t = await shoot(DESKTOP, 'screener-empty-1440', '/screener?q=zzzz-no-such-asset-zzzz');
record('empty state is explicit, not a crash', /0\b|no assets|nothing/i.test(t));

await browser.close();
fs.writeFileSync('qa-shots/results.json', JSON.stringify({ base: BASE, snapshot: SNAP, results }, null, 2) + '\n');
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(' -', f.name, f.detail); }
