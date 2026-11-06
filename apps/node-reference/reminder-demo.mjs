import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGuardianLifecycle,decodeGuardianLifecycle} from '../../shared/domain/guardian-lifecycle.mjs';
import {commitGuardianCommand} from '../../shared/domain/lifecycle-controller.mjs';
import {getUsageReminderEvent,readUsageGuidance} from '../../shared/domain/usage-reminders.mjs';
import {createSqliteLifecycleStore,openSqliteLifecycleStore} from './sqlite-store.mjs';

const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const directory=mkdtempSync(join(tmpdir(),'beaa-reminder-demo-'));
try{
 console.log('真实SQLite提醒计算演示；使用量为合成输入，没有发送系统通知或采集/限制其他应用。');
 for(const [name,dailyLimitMinutes,samples] of [['cycle',120,[1500,240,60]],['daily',15,[600,240,60]]]){
  const path=join(directory,`${name}.sqlite3`),store=await createSqliteLifecycleStore(path,createGuardianLifecycle(`reminder-${name}`,{...policy,dailyLimitMinutes},'2026-11-06'));
  for(const seconds of samples){
   const before=decodeGuardianLifecycle(await store.read());
   const result=await commitGuardianCommand(store,{lifecycleId:before.lifecycleId,eventId:`sample-${before.revision}`,expectedRevision:before.revision,type:'record_usage',payload:{seconds}});
   assert.equal(result.outcome,'committed');
   const after=decodeGuardianLifecycle(await store.read()),event=getUsageReminderEvent(before,after);
   assert(event);console.log(JSON.stringify({scenario:name,...event}));
  }
  const saved=await store.read(),reopened=await openSqliteLifecycleStore(path),view=await readUsageGuidance(reopened);
  assert.equal(await reopened.read(),saved);assert.equal(view.remainingUsageSeconds,0);assert.equal(view.dailyUsedSeconds,name==='cycle'?1800:900);
  console.log(JSON.stringify({scenario:name,reopened:true,phase:view.phase,dailyUsedSeconds:view.dailyUsedSeconds,unchanged:true}));
 }
}finally{rmSync(directory,{recursive:true,force:true});}
