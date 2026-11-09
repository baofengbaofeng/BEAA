import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {readFileSync} from 'node:fs';
const numeric={id:'numeric-ui',grade:3,subject:'math',topic:'arithmetic',type:'numeric',text:'1.5 + 1 = ?',answer:'2.5',explain:'1.5加1等于2.5。'};
async function configure(page,question,count=1){
 const bank=Array.isArray(question)?question:[question];
 await page.goto('/apps/web-preview/');await page.getByRole('button',{name:'家长设置',exact:true}).click();await page.getByLabel('家长 PIN',{exact:true}).fill('839271');await page.getByLabel('再次输入 PIN').fill('839271');await page.getByRole('button',{name:'设置 PIN',exact:true}).click();
 await page.getByLabel('每轮题数（1-20）').fill(String(count));await page.getByLabel('首次答对题数要求').fill(String(count));await page.getByLabel('休息时间（分钟）').fill('0');await page.getByRole('button',{name:'保存演示设置',exact:true}).click();await page.locator('#bank').fill(JSON.stringify(bank));await page.getByRole('button',{name:'校验并导入',exact:true}).click();await expect(page.getByText('已导入 '+bank.length+' 道题。',{exact:true})).toBeVisible();await page.getByRole('button',{name:'儿童主页',exact:true}).click();await page.getByRole('button',{name:'模拟用满当前周期',exact:true}).click();await page.getByRole('button',{name:'开始学习挑战',exact:true}).click();
}
test('numeric invalid entry is not an attempt; full-width decimal and Enter submit exactly',async({page})=>{
 await configure(page,numeric);const input=page.getByLabel('数字答案',{exact:true});await input.fill('2.5元');await page.getByRole('button',{name:'提交答案',exact:true}).click();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')).attempted)).toEqual([]);await expect(input).toHaveValue('2.5元');await input.fill('"><img src=x onerror=alert(1)>');await page.getByRole('button',{name:'提交答案',exact:true}).click();await expect(page.locator('#app img')).toHaveCount(0);await input.fill('２．５００');await input.press('Enter');await expect(page.getByRole('heading',{name:'挑战成功，获得待生效资格',exact:true})).toBeVisible();
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')));expect(state.history[0].correct).toBe(1);expect(state.phase).toBe('rest');
});
test('wrong numeric answer survives reload, never regains first score and supports isolated review',async({page})=>{
 await page.setViewportSize({width:360,height:800});await configure(page,numeric);await page.getByLabel('数字答案',{exact:true}).fill('4.00');await page.getByRole('button',{name:'提交答案',exact:true}).click();await page.reload();await page.getByLabel('数字答案',{exact:true}).fill('2.50');await page.getByRole('button',{name:'提交答案',exact:true}).click();await expect(page.getByRole('heading',{name:'本轮未通过，请再练习',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'错题本',exact:true}).click();await expect(page.getByText('原选择：4',{exact:true})).toBeVisible();const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')).history);await page.getByLabel('复习数字答案 1',{exact:true}).fill('２．５０');await page.getByRole('button',{name:'检查数字答案',exact:true}).click();await expect(page.getByText('答对了！1.5加1等于2.5。',{exact:true})).toBeVisible();expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')).history)).toEqual(before);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});
test('true false import renders two distinct large choices and old rest gating',async({page})=>{
 await configure(page,{...numeric,type:'true_false',text:'2大于1。',options:['正确','错误'],answer:0});await expect(page.getByRole('heading',{name:'判断题',exact:true})).toBeVisible();await expect(page.locator('[data-answer]')).toHaveCount(2);await page.getByRole('button',{name:/^A\s+正确$/}).click();await expect(page.getByRole('heading',{name:'挑战成功，获得待生效资格',exact:true})).toBeVisible();
});
test('numeric answer queued before quiet time cannot commit after quiet begins',async({page})=>{
 await page.clock.install({time:new Date('2026-11-09T20:59:00+08:00')});await configure(page,numeric);
 await page.evaluate(()=>{const key='beaa-web-preview-v1',state=JSON.parse(localStorage.getItem(key)),date=new Date(),day=(date.getDay()+6)%7+1,minute=date.getHours()*60+date.getMinutes();state.quietWindows=[{days:[day],startMinute:minute+1,endMinute:minute+2}];localStorage.setItem(key,JSON.stringify(state));});await page.reload();
 await page.getByLabel('数字答案',{exact:true}).fill('2.5');await page.evaluate(()=>{navigator.locks.request('beaa-state',()=>new Promise(resolve=>window.releaseNumericState=resolve));});await expect.poll(()=>page.evaluate(()=>typeof window.releaseNumericState)).toBe('function');await page.getByRole('button',{name:'提交答案',exact:true}).click();await page.clock.setFixedTime(new Date('2026-11-09T21:00:00+08:00'));await page.evaluate(()=>window.releaseNumericState());await expect(page.getByRole('heading',{name:'现在是禁用时段',exact:true})).toBeVisible();
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')));expect(state.question).toBe(0);expect(state.attempted).toEqual([]);
});

test('mixed sample completes a full five-question challenge without replacing the rest gate',async({page})=>{
 const bank=JSON.parse(readFileSync(new URL('../../shared/quiz/mixed-browser-questions.json',import.meta.url),'utf8'));await configure(page,bank,5);
 const responses=['32',0,'2.5',1,0];
 for(let index=0;index<responses.length;index++){await expect(page.getByRole('heading',{name:'第 '+(index+1)+' / 5 题',exact:true})).toBeVisible();if(typeof responses[index]==='string'){await page.getByLabel('数字答案',{exact:true}).fill(responses[index]);await page.getByRole('button',{name:'提交答案',exact:true}).click();}else await page.locator('[data-answer="'+responses[index]+'"]').click();}
 await expect(page.getByRole('heading',{name:'挑战成功，获得待生效资格',exact:true})).toBeVisible();const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')));expect(state.correct).toBe(5);expect(state.phase).toBe('rest');
});
