import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const results = [];
const browser = await chromium.launch();
try {
  for (const [stage, port] of [['before', 3340], ['after', 3339]]) {
    const base = `http://localhost:${port}`;
    const routes = [];
    for (const route of ['/', '/assets', '/screener', '/api/asset-images/status']) {
      await (await fetch(base + route)).text();
      const samples = [];
      for (let n = 0; n < 9; n++) {
        const start = performance.now();
        const response = await fetch(base + route);
        const ttfb = performance.now() - start;
        const body = await response.text();
        assert.equal(response.status, 200);
        samples.push({ttfb, total: performance.now() - start, htmlBytes: Buffer.byteLength(body)});
      }
      const median = key => +samples.map(s => s[key]).sort((a,b) => a-b)[4].toFixed(2);
      routes.push({route, medianTtfbMs: median('ttfb'), medianTotalMs: median('total'), bodyBytes: median('htmlBytes'), samples});
    }
    const browserChecks = [];
    for (const width of [1440,1280,1024,768,390]) {
      for (const route of ['/', '/screener']) {
        const page = await browser.newPage({viewport:{width,height:1000}});
        await page.addInitScript(() => {
          window.craftShifts = [];
          new PerformanceObserver(list => {
            for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.craftShifts.push(entry.value);
          }).observe({type:'layout-shift', buffered:true});
        });
        await page.goto(base + route, {waitUntil:'networkidle'});
        await page.evaluate(() => document.fonts.ready);
        if (route === '/') {
          await page.getByRole('tablist', {name:'Product preview'}).scrollIntoViewIfNeeded();
          await page.waitForTimeout(700);
        }
        const measured = await page.evaluate(() => ({
          layoutShiftSum: window.craftShifts.reduce((a,b) => a+b,0),
          jsBytes: performance.getEntriesByType('resource').filter(e=>e.name.includes('.js')).reduce((n,e)=>n+e.encodedBodySize,0),
          cssBytes: performance.getEntriesByType('resource').filter(e=>e.name.includes('.css')).reduce((n,e)=>n+e.encodedBodySize,0),
          imageBytes: performance.getEntriesByType('resource').filter(e=>e.initiatorType==='img').reduce((n,e)=>n+e.encodedBodySize,0),
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        }));
        assert.equal(measured.horizontalOverflow, false);
        browserChecks.push({route,width,...measured});
        await page.close();
      }
    }
    results.push({stage, routes, browserChecks});
    await fs.writeFile('reports/craft-polish/performance.json', JSON.stringify(results,null,2)+'\n');
    console.log(stage, JSON.stringify(routes.map(({samples,...r})=>r)));
  }
} finally { await browser.close(); }
