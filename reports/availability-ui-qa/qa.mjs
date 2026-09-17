import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const BASE = 'http://localhost:3402';
const results = [];
const rec = (n, p, d) => { results.push({ name: n, pass: p, detail: d }); console.log(`${p ? 'OK  ' : 'FAIL'} ${n}${d ? ' :: ' + d : ''}`); };
const browser = await chromium.launch();

async function grab(ctxOpts, label, path) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 60000 });
  const collapsed = await page.evaluate(() => document.body.innerText);
  const metricLabels = await page.evaluate(() =>
    [...document.querySelectorAll('.metric, [class*="metric"]')]
      .map(el => el.innerText.split('\n')[0].trim())
      .filter(Boolean));
  const notice = await page.evaluate(() => {
    const n = document.querySelector('.availability-notice');
    return n ? { text: n.innerText, state: n.getAttribute('data-state'), visible: !!(n.offsetWidth || n.offsetHeight) } : null;
  });
  await page.screenshot({ path: `qa-shots/${label}.png`, fullPage: true });
  await page.evaluate(() => { for (const d of document.querySelectorAll('details')) d.open = true; });
  await page.waitForTimeout(200);
  const expanded = await page.evaluate(() => document.body.innerText);
  rec(`${label} no page errors`, errs.length === 0, errs[0] || '');
  await ctx.close();
  return { collapsed, expanded, notice, metricLabels };
}
const D = { viewport: { width: 1440, height: 1000 } };
const M = devices['iPhone 13'];
const GONE = '/screener?q=' + encodeURIComponent('Souvenir AWP');

// ---- ACTIVE asset unchanged
let r = await grab(D, 'active-desktop-1440', '/screener?q=' + encodeURIComponent('Desert Eagle'));
rec('ACTIVE keeps "Current observation"', /Current observation/.test(r.collapsed));
rec('ACTIVE shows no availability notice', r.notice === null);
rec('ACTIVE keeps listing-reference label', /listing reference/i.test(r.collapsed));

// ---- NO_ACTIVE_LISTING_OBSERVED, desktop
r = await grab(D, 'no-listing-desktop-1440', GONE);
rec('notice is rendered and visible without expanding', !!r.notice && r.notice.visible, r.notice && r.notice.state);
rec('notice carries the correct state', r.notice?.state === 'NO_ACTIVE_LISTING_OBSERVED');
rec('headline visible in collapsed page', /No active listing observed/i.test(r.collapsed));
rec('says the price is not actionable', /not a price you can act on/i.test(r.collapsed));
rec('shows last successful observation timestamp', /last successful observation 2026-09-15T19:45/i.test(r.collapsed), (r.collapsed.match(/last successful observation \S+/i) || [])[0]);
rec('labels values LAST OBSERVED', /last observed/i.test(r.collapsed));
rec('NO "Current observation" anywhere on the page', !/Current observation/.test(r.expanded));
rec('NO "Minimum listing reference · USD" identity label', !/Minimum listing reference · USD/.test(r.expanded));
rec('retains evidence/provenance detail', /items feed was fetched successfully/i.test(r.expanded));
rec('no alarmist words', !/\b(error|failed|danger|critical|broken)\b/i.test(r.notice?.text || ''), r.notice?.text?.slice(0, 90));

// ---- mobile
r = await grab(M, 'no-listing-mobile-390', GONE);
rec('mobile: notice visible', !!r.notice && r.notice.visible);
rec('mobile: headline present', /No active listing observed/i.test(r.collapsed));
rec('mobile: no "Current observation"', !/Current observation/.test(r.expanded));

// ---- asset intelligence page for the same asset
const id = await (async () => {
  const ctx = await browser.newContext(D); const p = await ctx.newPage();
  await p.goto(BASE + GONE, { waitUntil: 'networkidle' });
  const href = await p.evaluate(() => document.querySelector('a[href^="/asset/"]')?.getAttribute('href'));
  await ctx.close(); return href;
})();
if (id) {
  r = await grab(D, 'asset-intelligence-desktop-1440', id);
  rec('asset page: notice visible', !!r.notice && r.notice.visible);
  rec('asset page: labels say last observed', /Last observed minimum listing/i.test(r.collapsed));
  // The requirement is about VALUE LABELS, not prose: explain() legitimately
  // describes observed change over a horizon ("listing quantity remained
  // unchanged over 1h"), which is a statement about the observed window, not a
  // claim that the value is live.
  const currentish = r.metricLabels.filter(l => /^(Venue listing quantity|Venue listings|Minimum listing reference)$/i.test(l));
  rec('asset page: no metric LABEL implies a current value', currentish.length === 0, currentish.join(' | ') || 'labels: ' + r.metricLabels.slice(0,6).join(' / '));
  r = await grab(M, 'asset-intelligence-mobile-390', id);
  rec('asset page mobile: notice visible', !!r.notice && r.notice.visible);
} else rec('asset detail link found', false);

await browser.close();
fs.writeFileSync('qa-shots/results.json', JSON.stringify({ base: BASE, results }, null, 2) + '\n');
const f = results.filter(x => !x.pass);
console.log(`\n${results.length - f.length}/${results.length} passed`);
if (f.length) { console.log('FAILED:'); for (const x of f) console.log(' -', x.name, x.detail || ''); }
