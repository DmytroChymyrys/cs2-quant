import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser = await chromium.launch(), results = [];
try {
  for (const width of [1440,1280,1024,768,390]) {
    const page = await browser.newPage({viewport:{width,height:1000}, reducedMotion:'reduce'});
    await page.goto('http://localhost:3339/portfolio', {waitUntil:'networkidle'});
    // Anonymous demo deliberately has no authenticated form. Exercise the shared
    // native dialog CSS with a browser-only fixture; no product write is sent.
    await page.evaluate(() => {
      const dialog = document.createElement('dialog');
      dialog.className = 'dialog';
      dialog.setAttribute('aria-label','Modal layout fixture');
      dialog.innerHTML = '<header class="panel-head"><h2>Manual holding</h2><button type="button">Close</button></header><div class="dialog-body"><label>Quantity <input type="number" value="1"></label><p>Browser-only layout fixture.</p></div>';
      document.body.append(dialog); dialog.showModal();
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    const backdrop = await dialog.evaluate(el => ({color:getComputedStyle(el,'::backdrop').backgroundColor,blur:getComputedStyle(el,'::backdrop').backdropFilter}));
    assert.equal(backdrop.blur, 'blur(8px)');
    await page.screenshot({path:`reports/craft-polish/after/modal-fixture-${width}.png`});
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.goto('http://localhost:3339/', {waitUntil:'networkidle'});
    const animation = await page.locator('.showcase-panel:not([hidden])').evaluate(el=>getComputedStyle(el).animationName);
    assert.equal(animation,'none');
    results.push({width,fixtureFits:true,nativeEscape:true,backdrop,reducedMotion:true});
    await page.close();
  }
} finally {
  await fs.writeFile('reports/craft-polish/overlay-check.json', JSON.stringify(results,null,2)+'\n');
  await browser.close();
}
