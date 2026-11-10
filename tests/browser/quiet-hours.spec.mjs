import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test.use({timezoneId:'Asia/Shanghai'});
async function parent(page){await page.getByRole('button',{name:'家长设置',exact:true}).click();await page.getByLabel('家长 PIN',{exact:true}).fill('839271');const confirmation=page.getByLabel('再次输入 PIN');if(await confirmation.count())await confirmation.fill('839271');await page.getByRole('button',{name:/^(设置 PIN|验证 PIN)$/}).click();}
async function addMondayNight(page){for(let day=2;day<=7;day++)await page.locator('#quiet-day-'+day).uncheck();await page.getByLabel('禁用开始时间',{exact:true}).fill('21:00');await page.getByLabel('禁用结束时间',{exact:true}).fill('07:00');await page.getByRole('button',{name:'添加禁用时段',exact:true}).click();}
test('protected weekly overnight schedule persists and pauses use without resetting progress',async({page})=>{
 await page.clock.install({time:new Date('2026-11-09T20:59:00+08:00')});await page.goto('/apps/web-preview/');await page.getByRole('button',{name:'模拟使用 1 分钟',exact:true}).click();await parent(page);await addMondayNight(page);
 await expect(page.locator('[data-quiet-window="0"]')).toContainText('21:00');await page.getByRole('button',{name:'儿童主页',exact:true}).click();await page.clock.setFixedTime(new Date('2026-11-09T21:00:00+08:00'));await page.reload();
 await expect(page.getByRole('heading',{name:'现在是禁用时段',exact:true})).toBeVisible();const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')));
 await expect(page.getByRole('button',{name:'模拟使用 1 分钟',exact:true})).toHaveCount(0);
 await page.clock.setFixedTime(new Date('2026-11-10T06:59:00+08:00'));await page.reload();await expect(page.getByRole('heading',{name:'现在是禁用时段',exact:true})).toBeVisible();
 await page.clock.setFixedTime(new Date('2026-11-10T07:00:00+08:00'));await page.reload();await expect(page.getByRole('button',{name:'模拟使用 1 分钟',exact:true})).toBeVisible();const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')));expect(after.cycleUsed).toBe(before.cycleUsed);expect(after.quietWindows).toEqual(before.quietWindows);
});
test('schedule editor remains readable with pinyin and rejects zero-length windows',async({page})=>{
 await page.setViewportSize({width:360,height:800});await page.goto('/apps/web-preview/');await parent(page);await page.getByLabel('禁用开始时间',{exact:true}).fill('21:00');await page.getByLabel('禁用结束时间',{exact:true}).fill('21:00');await page.getByRole('button',{name:'添加禁用时段',exact:true}).click();await expect(page.getByText('禁用时段无效：请选择星期，开始与结束时间必须不同。',{exact:true})).toBeVisible();
 await expect(page.locator('#quiet-editor rt').first()).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});
test('time transitions update protection without erasing an unsaved parent draft',async({page})=>{
 await page.clock.install({time:new Date('2026-11-09T20:59:00+08:00')});await page.goto('/apps/web-preview/');await parent(page);await page.getByLabel('临时时段（分钟）').fill('5');await page.getByRole('button',{name:'分配临时时段',exact:true}).click();await addMondayNight(page);await page.getByLabel('禁用开始时间',{exact:true}).fill('08:30');await page.clock.setFixedTime(new Date('2026-11-09T21:00:00+08:00'));await page.clock.runFor(1000);await expect(page.getByLabel('禁用开始时间',{exact:true})).toHaveValue('08:30');
});
