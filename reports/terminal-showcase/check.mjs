import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const stage=process.env.STAGE||'before',root='reports/terminal-showcase',base='http://localhost:3338';
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],results={pages:[],tabs:[]};
page.on('pageerror',e=>errors.push(e.message));
await fs.mkdir(`${root}/${stage}`,{recursive:true});
try {
  await page.goto(base+'/assets',{waitUntil:'networkidle'});
  const asset=await page.locator('a[href^="/asset/"]').first().getAttribute('href');
  for(const route of ['/terminal','/screener','/assets',asset,'/portfolio','/watchlist']) {
    await page.goto(base+route,{waitUntil:'networkidle'});
    const text=await page.locator('main').innerText();
    const geometry=await page.locator('main').evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight,images:el.querySelectorAll('img').length}));
    results.pages.push({route,text,geometry});
  }
  for(const width of [1440,1280,1024,768,390]) {
    await page.setViewportSize({width,height:1000});
    await page.goto(base+'/',{waitUntil:'networkidle'});
    const frame=page.locator('.showcase-workspace'),height=(await frame.boundingBox()).height;
    for(const [i,name] of ['01 Terminal','02 Screener','03 Asset intel'].entries()) {
      const tab=page.getByRole('tab',{name,exact:true}); await tab.click();
      await expect(tab).toHaveAttribute('aria-selected','true');
      await page.waitForTimeout(250);
      const panel=page.getByRole('tabpanel');
      await expect(panel).toHaveCount(1);
      assert.equal((await frame.boundingBox()).height,height);
      const screenshot=await panel.screenshot({path:`${root}/${stage}/tab-${i}-${width}.png`});
      results.tabs.push({width,tab:i,text:await panel.innerText(),screenshotSha256:createHash('sha256').update(screenshot).digest('hex')});
      if(stage==='after' && i===0) {
        const image=panel.getByRole('img'); await expect(image).toBeVisible();
        assert.ok(await image.evaluate(el=>el.complete&&el.naturalWidth>0));
        await expect(page.getByText('CONCEPT ILLUSTRATION · SAMPLE METRICS · NOT LIVE',{exact:true})).toBeVisible();
        assert.equal(await panel.locator('.intelligence-plot').count(),0);
        await page.locator('.lp-screen-frame').screenshot({path:`${root}/${stage}/terminal-frame-${width}.png`});
      }
    }
    await page.getByRole('tab',{name:'01 Terminal',exact:true}).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab',{name:'02 Screener',exact:true})).toBeFocused();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  }
  assert.deepEqual(errors,[]);
  if(stage==='after') {
    const before=JSON.parse(await fs.readFile(`${root}/before/results.json`,'utf8'));
    assert.deepEqual(results.pages,before.pages,'Other page content and geometry must remain unchanged');
    for(const tab of results.tabs.filter(x=>x.tab!==0)) {
      const old=before.tabs.find(x=>x.width===tab.width&&x.tab===tab.tab);
      assert.equal(tab.text,old.text,'Grounded preview content unchanged');
      assert.equal(tab.screenshotSha256,old.screenshotSha256,'Grounded preview pixels unchanged');
    }
  }
  console.log(`${stage}: six application pages and three tabs at five widths passed`);
}finally{await fs.writeFile(`${root}/${stage}/results.json`,JSON.stringify({...results,errors},null,2)+'\n');await browser.close();}
