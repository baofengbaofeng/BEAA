import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFile,writeFile} from 'node:fs/promises';
const path='/apps/browser-check/';
async function run(page){await page.getByRole('button',{name:'开始检查',exact:true}).click();await expect(page.locator('#summary')).toHaveAttribute('data-status',/^(passed|failed|incomplete|blocked)$/,{timeout:45000});}
test('isolated checks pass, export honest report and preserve all real storage',async({page})=>{
 await page.goto(path);await page.evaluate(()=>{localStorage.setItem('beaa-web-preview-v1','private-existing-progress');localStorage.setItem('family','private');});
 const before=await page.evaluate(()=>JSON.stringify({...localStorage}));await run(page);
 await expect(page.locator('#summary')).toHaveAttribute('data-status','passed');
 expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).toBe(before);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载检查报告'}).click();const file=await download;
 const report=JSON.parse(await readFile(await file.path(),'utf8'));expect(report.cases).toHaveLength(6);expect(report.cases.every(x=>x.status==='passed')).toBe(true);expect(report.crossAppUsageValidated).toBe(false);expect(report.healthOutcomeValidated).toBe(false);expect(JSON.stringify(report)).not.toContain('private');
 await writeFile('test-results/browser-self-check-report.json',JSON.stringify(report,null,2)+'\n');await page.screenshot({path:'test-results/browser-self-check.png',fullPage:true});
 await page.setViewportSize({width:360,height:800});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});
test('daily limit regression is detected instead of reporting success',async({page})=>{
 await page.route('**/web-preview/index.html',async route=>{const response=await route.fetch();let body=await response.text();body=body.replaceAll('s.phase="daily"','s.phase="available"').replaceAll("s.phase='daily'","s.phase='available'");await route.fulfill({response,body});});
 await page.goto(path);await run(page);await expect(page.locator('#summary')).toHaveAttribute('data-status','failed');await expect(page.locator('[data-case="daily"]')).toHaveAttribute('data-status','failed');
});
test('tampered embedded source blocks execution',async({page})=>{
 let body=await readFile(new URL('../../dist/beaa-browser-check.html',import.meta.url),'utf8');body=body.replace(/"sha256": "[a-f0-9]{64}"/,'"sha256": "'+ '0'.repeat(64)+'"');
 await page.route('**/dist/beaa-browser-check.html',route=>route.fulfill({contentType:'text/html',body}));await page.goto('/dist/beaa-browser-check.html');await run(page);await expect(page.locator('#summary')).toHaveAttribute('data-status','blocked');expect(await page.locator('iframe').count()).toBe(0);
});
test('standalone file completes with no HTTP requests',async({page})=>{
 const requests=[];page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});
 try{await page.goto(new URL('../../dist/beaa-browser-check.html',import.meta.url).href);}catch(error){test.skip(!process.env.CI&&String(error).includes('ERR_BLOCKED_BY_ADMINISTRATOR'),'Local enterprise policy blocks file navigation; CI must validate file.');throw error;}
 await run(page);await expect(page.locator('#summary')).toHaveAttribute('data-status','passed');expect(requests).toEqual([]);
});
test('unavailable storage isolation never runs the app or touches real progress',async({page,context})=>{
 await context.addInitScript(()=>{if(window!==window.top)Object.defineProperty(window,'localStorage',{value:window.localStorage,configurable:false});});
 await page.goto(path);await page.evaluate(()=>localStorage.setItem('beaa-web-preview-v1','keep-me'));await run(page);
 await expect(page.locator('#summary')).toHaveAttribute('data-status','incomplete');expect(await page.evaluate(()=>localStorage.getItem('beaa-web-preview-v1'))).toBe('keep-me');await expect(page.locator('[data-status="unsupported"]')).toHaveCount(6);
});

test('attempting use during pending rest exposes a bypass regression',async({page})=>{
 await page.route('**/web-preview/index.html',async route=>{const response=await route.fetch();const original=await response.text();const body=original.replace('function usableMinutes(){',"function usableMinutes(){if(s.phase==='rest')return 10;");expect(body).not.toBe(original);await route.fulfill({response,body});});
 await page.goto(path);await run(page);await expect(page.locator('#summary')).toHaveAttribute('data-status','failed');await expect(page.locator('[data-case="rest"]')).toHaveAttribute('data-status','failed');
});
test('a never-settling app operation times out with a downloadable failed report',async({page})=>{
 test.setTimeout(60000);
 await page.route('**/web-preview/index.html',async route=>{const response=await route.fetch();const body=(await response.text()).replace("navigator.locks.request('beaa-state',fn)","navigator.locks.request('beaa-state',()=>new Promise(()=>{}))");await route.fulfill({response,body});});
 await page.goto(path);await run(page);await expect(page.locator('#summary')).toHaveAttribute('data-status','failed');await expect(page.getByRole('button',{name:'下载检查报告'})).toBeEnabled();
});
