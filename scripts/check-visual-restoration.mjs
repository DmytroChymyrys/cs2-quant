import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch(),page=await browser.newPage(),errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});
  for(const route of ['/terminal','/screener','/assets']){
   const r=await page.goto('http://localhost:3338'+route,{waitUntil:'networkidle'});assert.equal(r.status(),200);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   await page.screenshot({path:`reports/visual-restoration/${route.slice(1)}-${width}.png`,fullPage:true});results.push({route,width,overflow});assert.equal(overflow,false);
   if(route==='/terminal'){
    const chart=await page.locator('.primary-intelligence').boundingBox();
    if(width>=1000)assert.ok(chart.y<450);
    const monitor=await page.getByRole('heading',{name:'Listings contraction monitor'}).boundingBox();assert.ok(chart.y<monitor.y);
    assert.equal(await page.getByRole('heading',{name:'Top price movers'}).count(),1);
   }else{
    assert.equal(await page.locator('.inspection-rail').count(),1);
    for(const name of ['Synthetic · Quiet market','Synthetic · Rising price']){
     await page.getByRole('link',{name:`Inspect ${name}`,exact:true}).click();await page.waitForLoadState('networkidle');
     await expect(page.locator('.inspection-identity h2')).toHaveText(name);
    }
   }
  }
 }
 assert.deepEqual(errors,[]);await writeFile('reports/visual-restoration/checks.json',JSON.stringify({evidence:'SYNTHETIC LOCAL ONLY',results,errors},null,2));console.log({results,errors});
}finally{await browser.close();}
