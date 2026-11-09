import {test,expect} from '@playwright/test';
test('Chinese interface has tone-marked readings while keeping original accessible names',async({page})=>{
 await page.goto('/apps/web-preview/');
 await expect(page.getByRole('button',{name:'儿童主页',exact:true})).toBeVisible();
 await expect(page.locator('nav ruby rt').first()).toContainText('ér');
 await page.getByRole('button',{name:'家长设置',exact:true}).click();
 await expect(page.locator('h1 rt')).toContainText('jiā');
 await expect(page.getByLabel('家长 PIN',{exact:true})).toBeVisible();
 const readings=await page.evaluate(()=>window.beaaReadings('重新挑战，音乐和快乐，银行行长'));
 expect(readings).toContain('chóng'); expect(readings).toContain('yuè'); expect(readings).toContain('háng');
});
test('dynamic and imported Chinese is annotated safely and wraps at narrow and enlarged sizes',async({page})=>{
 await page.setViewportSize({width:320,height:740});await page.goto('/apps/web-preview/');
 await page.getByRole('button',{name:'模拟用满当前周期',exact:true}).click();
 await expect(page.locator('main ruby')).not.toHaveCount(0);
 const result=await page.evaluate(()=>{const p=document.createElement('p');p.id='imported-reading';p.textContent='重新学习，快乐成长 <img src=x onerror=alert(1)>';document.querySelector('main').append(p);window.beaaAnnotate(p);return {text:p.textContent,html:p.innerHTML};});
 expect(result.html).toContain('<ruby>');expect(result.html).not.toContain('<img');
 await page.evaluate(()=>document.documentElement.style.fontSize='24px');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('reset confirmation has readings and cancelled reset preserves progress',async({page})=>{
 await page.goto('/apps/web-preview/');await page.getByRole('button',{name:'模拟使用 1 分钟',exact:true}).click();
 await page.getByRole('button',{name:'家长设置',exact:true}).click();await page.getByLabel('家长 PIN',{exact:true}).fill('839271');await page.getByLabel('再次输入 PIN').fill('839271');await page.getByRole('button',{name:'设置 PIN',exact:true}).click();
 const dialogPromise=page.waitForEvent('dialog');const click=page.getByRole('button',{name:'重置演示数据',exact:true}).click();const dialog=await dialogPromise;expect(dialog.message()).toContain('chóng zhì');await dialog.dismiss();await click;
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')).dailyUsed)).toBe(1);
});
