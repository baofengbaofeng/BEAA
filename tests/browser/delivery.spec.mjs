import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function parent(page){await page.getByRole('button',{name:'家长设置',exact:true}).click();await page.getByLabel('家长 PIN',{exact:true}).fill('839271');const c=page.getByLabel('再次输入 PIN');if(await c.count())await c.fill('839271');await page.getByRole('button',{name:/^(设置 PIN|验证 PIN)$/}).click();await expect(page.getByLabel('临时时段（分钟）')).toBeVisible();}
test('bounded parent use is persisted, exhausted and cannot resume until parent ends it',async({page})=>{
 await page.goto('/apps/web-preview/');await parent(page);await page.getByLabel('临时时段（分钟）').fill('2');await page.getByRole('button',{name:'分配临时时段',exact:true}).click();
 await page.getByRole('button',{name:'儿童主页',exact:true}).click();await page.getByRole('button',{name:'模拟使用 10 分钟',exact:true}).click();await page.getByRole('button',{name:'模拟使用 10 分钟',exact:true}).click();await expect(page.getByText('已使用 2 分钟',{exact:true})).toBeVisible();await expect(page.getByText(/临时时段已结束/).first()).toBeVisible();
 await page.reload();await page.getByRole('button',{name:'模拟使用 10 分钟',exact:true}).click();await expect(page.getByText('已使用 2 分钟',{exact:true})).toBeVisible();
 await parent(page);await page.getByRole('button',{name:'结束临时模式',exact:true}).click();await expect(page.getByText(/临时时段结束/).first()).toBeVisible();
 const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(results.violations).toEqual([]);
});
test('learning summary downloads without private credentials and default reminders appear',async({page})=>{
 await page.goto('/apps/web-preview/');await parent(page);const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出学习摘要 JSON'}).click();const file=await download;const stream=await file.createReadStream();const chunks=[];for await(const c of stream)chunks.push(c);const text=Buffer.concat(chunks).toString('utf8');const report=JSON.parse(text);expect(report.simulated).toBe(true);expect(text).not.toMatch(/pinHash|pinSalt|839271/);
 await page.getByRole('button',{name:'儿童主页',exact:true}).click();for(let i=0;i<25;i++)await page.getByRole('button',{name:'模拟使用 1 分钟',exact:true}).click();await expect(page.getByText('本轮剩余 5 分钟，请准备学习和休息。',{exact:true})).toBeVisible();
});
test('critical corruption blocks interaction and preserves the original storage bytes',async({page})=>{
 await page.goto('/apps/web-preview/');const raw=await page.evaluate(()=>{const key='beaa-web-preview-v1';const s=JSON.parse(localStorage.getItem(key));s.dailyUsed=-1;const raw=JSON.stringify(s);localStorage.setItem(key,raw);return raw;});await page.reload();await expect(page.getByRole('heading',{name:'数据需要恢复'})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('beaa-web-preview-v1'))).toBe(raw);await expect(page.getByRole('button',{name:'模拟用满当前周期'})).toHaveCount(0);
});
test('wall expiry stops a temporary session while the page is open',async({page})=>{
 await page.clock.install({time:new Date('2026-11-06T12:00:00Z')});await page.goto('/apps/web-preview/');await parent(page);await page.getByLabel('临时时段（分钟）').fill('1');await page.getByRole('button',{name:'分配临时时段',exact:true}).click();await page.getByRole('button',{name:'儿童主页',exact:true}).click();await page.clock.fastForward(60000);await expect(page.getByText(/临时时段已结束/).first()).toBeVisible();await page.getByRole('button',{name:'模拟使用 1 分钟',exact:true}).click();await expect(page.getByText('已使用 0 分钟',{exact:true})).toBeVisible();
});
test('two real tabs cannot spend a temporary budget twice',async({page,context})=>{
 await page.goto('/apps/web-preview/');await parent(page);await page.getByLabel('临时时段（分钟）').fill('2');await page.getByRole('button',{name:'分配临时时段',exact:true}).click();await page.getByRole('button',{name:'儿童主页',exact:true}).click();const other=await context.newPage();await other.goto('/apps/web-preview/');
 await Promise.all([page.getByRole('button',{name:'模拟使用 1 分钟',exact:true}).click(),other.getByRole('button',{name:'模拟使用 1 分钟',exact:true}).click()]);
 await expect(page.getByText('已使用 2 分钟',{exact:true})).toBeVisible();await Promise.all([page.getByRole('button',{name:'模拟使用 10 分钟',exact:true}).click(),other.getByRole('button',{name:'模拟使用 10 分钟',exact:true}).click()]);await expect(other.getByText('已使用 2 分钟',{exact:true})).toBeVisible();await other.close();
});

test('delayed minimum permit can spend sub-minute allowance and keep exact seconds after reload',async({page})=>{
 const start=new Date('2026-11-06T12:00:00Z');await page.clock.setFixedTime(start);await page.goto('/apps/web-preview/');await parent(page);await page.getByLabel('临时时段（分钟）').fill('1');await page.getByRole('button',{name:'分配临时时段',exact:true}).click();await page.clock.setFixedTime(new Date(start.getTime()+1001));await page.getByRole('button',{name:'儿童主页',exact:true}).click();await page.getByRole('button',{name:'模拟使用 1 分钟',exact:true}).click();await expect(page.getByText('已使用 0 分钟 58 秒',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('已使用 0 分钟 58 秒',{exact:true})).toBeVisible();await page.getByRole('button',{name:'模拟使用 1 秒',exact:true}).click();await expect(page.getByText('已使用 0 分钟 59 秒',{exact:true})).toBeVisible();
});
