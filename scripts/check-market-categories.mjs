import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch(),page=await browser.newPage(),base='http://localhost:3338',errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
const nav=()=>page.getByRole('navigation',{name:'Item categories'});
async function category(name){await nav().getByRole('link',{name:new RegExp('^'+name+' \\d+$')}).click();await expect(nav().locator('[aria-current="page"]')).toContainText(name);}
async function rowsContain(pattern){await expect.poll(async()=>{const texts=await page.locator('.results-surface tbody tr td:first-child').allTextContents();return texts.length>0&&texts.every(t=>pattern.test(t));}).toBe(true);}
try {
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    for(const route of ['/assets','/screener']) {
      await page.goto(base+route,{waitUntil:'networkidle',timeout:90000});
      await page.evaluate(()=>{window.categoryNavigationMarker='retained';});
      await category('Knives');await rowsContain(/Knife/);
      assert.equal(await page.evaluate(()=>window.categoryNavigationMarker),'retained');
      assert.equal(new URL(page.url()).searchParams.get('category'),'knives');
      await expect(page.locator('.results-surface tbody tr')).toHaveCount(5);
      await page.screenshot({path:`reports/category-browsing/${route.slice(1)}-knives-${width}.png`,fullPage:true});
      await category('Gloves');await rowsContain(/Gloves/);
      await page.goBack();await expect(nav().locator('[aria-current="page"]')).toContainText('Knives');await rowsContain(/Knife/);
      await page.reload({waitUntil:'networkidle'});await rowsContain(/Knife/);
      await category('Gloves');await rowsContain(/Gloves/);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      const visible=await nav().evaluate(n=>{const c=n.getBoundingClientRect(),a=n.querySelector('[aria-current="page"]').getBoundingClientRect();return a.left>=c.left-1&&a.right<=c.right+1;});assert.ok(visible);
      await page.screenshot({path:`reports/category-browsing/${route.slice(1)}-gloves-${width}.png`,fullPage:true});
      results.push({route,width,knives:5,gloves:5,history:true,refresh:true,clientNavigation:true,selectedVisible:true});
    }
    await page.goto(base+'/terminal?min=10&volMin=0&sourceMax=900',{waitUntil:'networkidle'});
    await category('Knives');
    await expect.poll(async()=>{const names=await page.locator('select[name=asset] option').allTextContents();return names.length>0&&names.every(n=>n.includes('Knife'));}).toBe(true);
    await page.getByRole('navigation',{name:'Market presets'}).getByRole('link',{name:'Volatility',exact:true}).click();
    await expect(page).toHaveURL(/preset=volatility/);
    assert.equal(new URL(page.url()).searchParams.get('category'),'knives');
    assert.equal(new URL(page.url()).searchParams.get('min'),'10');
    await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page).toHaveURL(/category=knives/);
    assert.equal(new URL(page.url()).searchParams.get('volMin'),'0');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:`reports/category-browsing/terminal-knives-${width}.png`,fullPage:true});
    results.push({route:'/terminal',width,categoryAndPreset:true,formRetainsFilters:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  const filters=new URLSearchParams({preset:'volatility',sort:'price',direction:'asc',horizon:'6h',min:'1',max:'2000',volMin:'0',volMax:'10',activityMin:'0',coverageMin:'90',sourceMax:'900',listingMin:'1',listingMax:'50000',page:'2'});
  await page.goto(base+'/screener?'+filters,{waitUntil:'networkidle'});await category('Knives');await rowsContain(/Knife/);
  for(const [key,value] of filters) if(key!=='page') assert.equal(new URL(page.url()).searchParams.get(key),value,key);
  await page.locator('select[name=preset]').selectOption('down');
  await page.getByRole('button',{name:'Run screen',exact:true}).click();await expect(page).toHaveURL(/preset=down/);
  for(const [key,value] of filters) if(!['page','preset'].includes(key))assert.equal(new URL(page.url()).searchParams.get(key),value,key);
  assert.equal(new URL(page.url()).searchParams.get('category'),'knives');
  await category('SMGs');
  await expect(page.getByText('No assets match these filters.',{exact:false})).toBeVisible();
  assert.deepEqual(errors,[]);
  await writeFile('reports/category-browsing/browser.json',JSON.stringify({passed:true,results,combinedFilters:true,emptyCategory:true,errors},null,2));
  console.log(JSON.stringify({passed:true,cases:results.length,errors}));
}finally{await browser.close();}
