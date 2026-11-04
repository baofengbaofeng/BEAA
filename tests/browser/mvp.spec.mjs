import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const path='/apps/web-preview/';
async function parent(page){
 await page.getByRole('button',{name:'家长设置',exact:true}).click();
 await page.getByLabel('家长 PIN',{exact:true}).fill('839271');
 const confirm=page.getByLabel('再次输入 PIN');if(await confirm.count())await confirm.fill('839271');
 await page.getByRole('button',{name:/^(设置 PIN|验证 PIN)$/}).click();
 await expect(page.getByLabel('单轮使用时长（分钟）')).toBeVisible();
}
async function start(page){await page.getByRole('button',{name:'儿童主页',exact:true}).click();await page.getByRole('button',{name:'模拟用满当前周期'}).click();await page.getByRole('button',{name:'开始学习挑战'}).click();}
async function solve(page){for(const answer of ['C','B','A','C','C'])await page.getByRole('button',{name:new RegExp('^'+answer+'\\s')}).click();}
const errorsByPage=new WeakMap();
test.beforeEach(async({page})=>{const errors=[];errorsByPage.set(page,errors);page.on('pageerror',error=>errors.push(error.message));await page.goto(path);});
test.afterEach(async({page})=>{expect(errorsByPage.get(page)).toEqual([]);});

test('PIN-protected settings, refresh, rest and daily cap',async({page})=>{
 await parent(page);
 await page.getByLabel('每日使用上限（分钟）').fill('60');
 await page.getByLabel('休息时间（分钟）').fill('0');
 await page.getByRole('button',{name:'保存演示设置'}).click();
 await start(page);await solve(page);
 await expect(page.getByRole('heading',{name:'挑战成功，获得待生效资格'})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'挑战成功，获得待生效资格'})).toBeVisible();
 await page.getByRole('button',{name:'检查休息条件'}).click();
 await expect(page.getByText('已使用 30 分钟',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'模拟用满当前周期'}).click();
 await expect(page.getByText('已达每日上限',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'模拟使用 10 分钟'}).click();
 await expect(page.getByText('已使用 60 分钟',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'家长设置',exact:true}).click();
 await expect(page.getByLabel('家长 PIN',{exact:true})).toBeVisible();
 await page.getByLabel('家长 PIN',{exact:true}).fill('000000');
 await page.getByRole('button',{name:'验证 PIN'}).click();
 await expect(page.getByRole('status')).toContainText('PIN 不正确');
});

test('failed first attempt records review, statistics and refuses a grant',async({page})=>{
 await start(page);await page.getByRole('button',{name:/^A\s/}).click();await solve(page);
 await expect(page.getByRole('heading',{name:'本轮未通过，请再练习'})).toBeVisible();
 await page.getByRole('button',{name:'错题本',exact:true}).click();
 await expect(page.getByRole('heading',{name:'36 ÷ 4 + 7 = ?'})).toBeVisible();
 await page.getByRole('button',{name:'16',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('答对了');
 await page.getByRole('button',{name:'学习记录',exact:true}).click();
 await expect(page.getByText(/首次正确率 80%/)).toBeVisible();
 await page.reload();await expect(page.getByText(/首次正确率 80%/)).toBeVisible();
});

test('pending rest refuses early completion and clock rollback',async({page})=>{
 await start(page);await solve(page);await page.getByRole('button',{name:'检查休息条件'}).click();
 await expect(page.getByRole('status')).toContainText('休息时间尚未达到');
 await page.evaluate(()=>{const real=Date.now();Date.now=()=>real-3600000;});
 await page.getByRole('button',{name:'检查休息条件'}).click();
 await expect(page.getByRole('status')).toContainText('时间回拨');
});

test('resizing and reloading retain exact current question',async({page})=>{
 await start(page);await page.getByRole('button',{name:/^C\s/}).click();
 // A click queues the asynchronous state lock; reload only after the answer is acknowledged.
 await expect(page.getByRole('heading',{name:'第 2 / 5 题'})).toBeVisible();
 for(const viewport of [{width:1024,height:768},{width:360,height:800},{width:768,height:1024}]){
  await page.setViewportSize(viewport);await page.reload();
  await expect(page.getByRole('heading',{name:'第 2 / 5 题'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }
 await page.screenshot({path:'test-results/challenge-portrait.png',fullPage:true});
});

test('keyboard navigation, semantic accessibility and narrow layout',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 for(const name of ['儿童主页','学习挑战','挑战结果','家长设置']){
  await page.getByRole('button',{name,exact:true}).click();
  const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }
 await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement.tagName)).toBe('INPUT');
 await page.screenshot({path:'test-results/parent-narrow.png',fullPage:true});
});

test('imported questions use selected grade and render as text',async({page})=>{
 await parent(page);
 await page.getByLabel('年级（1-6）').fill('1');
 await page.getByLabel('每轮题数（1-20）').fill('1');
 await page.getByLabel('首次答对题数要求').fill('1');
 await page.getByRole('button',{name:'保存演示设置'}).click();
 const bank=[{id:'custom',grade:1,subject:'math',topic:'arithmetic',text:'<img src=x onerror=alert(1)> 2+2?',options:['4','5'],answer:0,explain:'2+2=4'}];
 await page.getByLabel('导入题库 JSON 数组（替换内置题库）').fill(JSON.stringify(bank));
 await page.getByRole('button',{name:'校验并导入'}).click();
 await expect(page.getByRole('status')).toContainText('已导入 1 道题');
 await start(page);await expect(page.getByText(bank[0].text,{exact:true})).toBeVisible();
 expect(await page.locator('#app img').count()).toBe(0);
});

test('single HTML file works without any server or network requests',async({page})=>{
 const file=new URL('../../apps/web-preview/index.html',import.meta.url);
 const requests=[];page.on('request',r=>{if(r.url().startsWith('http'))requests.push(r.url());});
 try { await page.goto(file.href); } catch(error) {
  test.skip(!process.env.CI && String(error).includes('ERR_BLOCKED_BY_ADMINISTRATOR'),'Managed Chromium policy blocks local file:// navigation; CI must validate the standalone file.');throw error;
 }
 await start(page);await solve(page);
 await expect(page.getByRole('heading',{name:'挑战成功，获得待生效资格'})).toBeVisible();expect(requests).toEqual([]);
});

test('active quiz, rest, review and unlocked settings pass accessibility checks',async({page})=>{
 await parent(page);
 for(const viewport of [{width:360,height:800},{width:1180,height:800}]){
  await page.setViewportSize(viewport);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }
 await start(page);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
 await solve(page);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});


test('loaded standalone page completes a challenge while offline',async({page,context})=>{
 const external=[];page.on('request',r=>external.push(r.url()));await context.setOffline(true);
 await start(page);await solve(page);
 await expect(page.getByRole('heading',{name:'挑战成功，获得待生效资格'})).toBeVisible();expect(external).toEqual([]);
});

test('two tabs preserve PIN and serialize simulated usage at the daily cap',async({page,context})=>{
 const other=await context.newPage();await other.goto(path);
 await parent(page);
 await other.getByRole('button',{name:'家长设置',exact:true}).click();
 await expect(other.getByLabel('再次输入 PIN')).toHaveCount(0);
 await expect(other.getByRole('button',{name:'验证 PIN'})).toBeVisible();
 await parent(page);
 await page.getByLabel('每日使用上限（分钟）').fill('30');
 await page.getByRole('button',{name:'保存演示设置'}).click();
 await Promise.all([page.getByRole('button',{name:'儿童主页',exact:true}).click(),other.getByRole('button',{name:'儿童主页',exact:true}).click()]);
 await Promise.all([page.getByRole('button',{name:'模拟用满当前周期'}).click(),other.getByRole('button',{name:'模拟用满当前周期'}).click()]);
 await other.getByRole('button',{name:'儿童主页',exact:true}).click();await page.reload();
 await expect(page.getByText('已达每日上限',{exact:true})).toBeVisible();
 await expect(other.getByText('已使用 30 分钟',{exact:true})).toBeVisible();
 await other.close();
});

test('keyboard can retry a wrong answer without losing focus',async({page})=>{
 await start(page);const wrong=page.getByRole('button',{name:/^A\s/});await wrong.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('status')).toContainText('再想一想');await expect(wrong).toBeFocused();
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'第 2 / 5 题'})).toBeVisible();
});

test('opening a tab during first PIN derivation preserves one complete credential',async({page,context})=>{
 const observeWrites=()=>{window.observedWrites=[];const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='beaa-web-preview-v1'){const x=JSON.parse(value);window.observedWrites.push({pin:!!x.pinHash,salt:!!x.pinSalt,note:x.answerNote,page:x.page,stack:new Error().stack.split('\n').slice(1,5).join(' ')});}return original.call(this,key,value);};};
 await page.evaluate(observeWrites);await context.addInitScript(observeWrites);

 await page.getByRole('button',{name:'家长设置',exact:true}).click();
 await page.getByLabel('家长 PIN',{exact:true}).fill('839271');await page.getByLabel('再次输入 PIN').fill('839271');
 await page.evaluate(()=>{const original=pinDigest;pinDigest=async(...args)=>{window.digestStarted=true;window.digestStage='waiting';await new Promise(resolve=>window.releaseDigest=resolve);window.digestStage='deriving';const result=await original(...args);window.digestStage='derived';return result;};});
 await page.getByRole('button',{name:'设置 PIN'}).click();await expect.poll(()=>page.evaluate(()=>window.digestStarted)).toBeTruthy();
 const other=await context.newPage();await other.goto(path);await page.evaluate(()=>window.releaseDigest());
 try {await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')).pinHash)).toMatch(/^[a-f0-9]{64}$/);}catch(error){
  const diagnostics=await page.evaluate(async()=>({stage:window.digestStage,busy,interactionPending,inMemoryPin:!!s.pinHash,inLastSavedPin:!!JSON.parse(lastSaved).pinHash,storedPin:!!JSON.parse(localStorage.getItem(STORAGE)).pinHash,note:s.answerNote,locks:await navigator.locks.query()}));
  const writes=await page.evaluate(()=>window.observedWrites),otherWrites=await other.evaluate(()=>window.observedWrites);
  throw Error(error.message+'\nPIN race diagnostics: '+JSON.stringify({diagnostics,writes,otherWrites}));
 }
 expect(await other.evaluate(()=>window.observedWrites)).toHaveLength(0);
 await other.getByRole('button',{name:'家长设置',exact:true}).click();
 await expect(other.getByLabel('再次输入 PIN')).toHaveCount(0);
 await other.getByLabel('家长 PIN',{exact:true}).fill('839271');await other.getByRole('button',{name:'验证 PIN'}).click();
 await expect(other.getByLabel('每日使用上限（分钟）')).toBeVisible();await other.close();
});


test('an answer queued behind a state lock is committed before acknowledged progress reloads',async({page})=>{
 await start(page);
 await page.evaluate(()=>{navigator.locks.request('beaa-state',()=>new Promise(resolve=>window.releaseStateForTest=resolve));});
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseStateForTest)).toBe('function');
 const answer=page.getByRole('button',{name:/^C\s/});await answer.click();await expect(answer).toBeDisabled();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')).question)).toBe(0);
 await page.evaluate(()=>window.releaseStateForTest());
 await expect(page.getByRole('heading',{name:'第 2 / 5 题'})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'第 2 / 5 题'})).toBeVisible();
});
