import {test,expect} from '@playwright/test';
test('only committed simulated state reaches the notification host and contains no credentials or answers',async({page})=>{
 await page.addInitScript(()=>{window.reminderInputs=[];window.nativePauses=0;window.beaaNative={updateReminderState:text=>{window.reminderInputs.push(JSON.parse(text));return 'accepted';},pauseReminders:()=>{window.nativePauses++;return 'accepted';}};});
 await page.goto('/apps/web-preview/');await expect.poll(()=>page.evaluate(()=>window.reminderInputs.length)).toBeGreaterThan(0);const first=await page.evaluate(()=>window.reminderInputs.at(-1));expect(first.simulated).toBe(true);expect(first.scopeId).toBe('web-preview');expect(first.cycleRemainingSeconds).toBe(1800);expect(JSON.stringify(first)).not.toMatch(/pinHash|pinSalt|correctOptionId|explanation/);
 await page.getByRole('button',{name:'模拟使用 1 分钟',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.reminderInputs.at(-1).cycleRemainingSeconds)).toBe(1740);
 const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('beaa-web-preview-v1')));expect(await page.evaluate(()=>window.reminderInputs.at(-1).revision)).toBe(state.stateRevision);
 await page.evaluate(()=>window.onNativeReminderReady());expect(await page.evaluate(()=>window.reminderInputs.at(-1).revision)).toBe(state.stateRevision);
});
test('corrupt local data requests pause instead of supplying invented available state',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('beaa-web-preview-v1','{broken');window.reminderInputs=[];window.nativePauses=0;window.beaaNative={updateReminderState:text=>{window.reminderInputs.push(text);return 'accepted';},pauseReminders:()=>{window.nativePauses++;return 'accepted';}};});await page.goto('/apps/web-preview/');await expect(page.getByRole('heading',{name:'数据需要恢复'})).toBeVisible();expect(await page.evaluate(()=>window.reminderInputs.length)).toBe(0);expect(await page.evaluate(()=>window.nativePauses)).toBeGreaterThan(0);expect(await page.evaluate(()=>localStorage.getItem('beaa-web-preview-v1'))).toBe('{broken');
});
