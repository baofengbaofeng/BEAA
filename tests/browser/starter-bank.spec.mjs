import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
const exported=JSON.parse(readFileSync(new URL('../../dist/beaa-starter-bank/beaa-starter-bank.browser.json',import.meta.url),'utf8'));
for(let grade=1;grade<=6;grade++)for(const subject of ['chinese','math','english'])test(`starter grade ${grade} ${subject}: import, retain usage and pass five real UI questions`,async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/apps/web-preview/');
 await page.getByRole('button',{name:'模拟使用 10 分钟'}).click();await page.getByRole('button',{name:'家长设置',exact:true}).click();await page.getByLabel('家长 PIN',{exact:true}).fill('839271');await page.getByLabel('再次输入 PIN').fill('839271');await page.getByRole('button',{name:'设置 PIN',exact:true}).click();await expect(page.getByLabel('年级（1-6）')).toBeVisible();
 await page.getByLabel('导入题库 JSON 数组（替换内置题库）').fill(JSON.stringify(exported));await page.getByRole('button',{name:'校验并导入'}).click();await expect(page.getByRole('status')).toContainText('已导入 90 道题');
 await page.getByLabel('年级（1-6）').fill(String(grade));await page.getByLabel('学科',{exact:true}).selectOption(subject);await page.getByLabel('知识点',{exact:true}).selectOption({chinese:'poetry',math:'arithmetic',english:'vocabulary'}[subject]);await page.getByRole('button',{name:'保存演示设置'}).click();
 await page.getByRole('button',{name:'儿童主页',exact:true}).click();await expect(page.getByText('已使用 10 分钟',{exact:true})).toBeVisible();await page.getByRole('button',{name:'模拟用满当前周期'}).click();await page.getByRole('button',{name:'开始学习挑战'}).click();
 const questions=exported.filter(q=>q.grade===grade&&q.subject===subject);expect(questions).toHaveLength(5);
 for(let i=0;i<5;i++){
  await expect(page.getByRole('heading',{name:`第 ${i+1} / 5 题`})).toBeVisible();await expect(page.getByText(questions[i].text,{exact:true})).toBeVisible();
  if(grade===6&&subject==='math'&&i===1){await page.setViewportSize({width:360,height:800});await page.reload();await expect(page.getByRole('heading',{name:'第 2 / 5 题'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'test-results/starter-fractions-portrait.png',fullPage:true});}
  const letter=String.fromCharCode(65+questions[i].answer);await page.getByRole('button',{name:new RegExp('^'+letter+'\\s')}).click();
 }
 await expect(page.getByRole('heading',{name:'挑战成功，获得待生效资格'})).toBeVisible();await page.getByRole('button',{name:'检查休息条件'}).click();await expect(page.getByRole('status')).toContainText('休息时间尚未达到');expect(errors).toEqual([]);
});
