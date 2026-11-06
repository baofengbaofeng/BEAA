import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadNativeCore} from '../../scripts/native-core.mjs';
import {createSqliteReminderStore,openSqliteReminderStore} from './reminder-store.mjs';
import {createSqliteLifecycleStore} from './sqlite-store.mjs';
import {createGuardianLifecycle,decodeGuardianLifecycle} from '../../shared/domain/guardian-lifecycle.mjs';
import {getUsageGuidance} from '../../shared/domain/usage-reminders.mjs';
import {commitGuardianCommand} from '../../shared/domain/lifecycle-controller.mjs';
const {ReminderDelivery}=loadNativeCore(['ReminderDelivery']);
const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const directory=mkdtempSync(join(tmpdir(),'beaa-notification-demo-'));
try{
 console.log('真实SQLite队列演示；使用数据为合成输入，通知端口为记录型测试替身，没有发送系统通知或控制其他应用。');
 const guardian=await createSqliteLifecycleStore(join(directory,'guardian.sqlite3'),createGuardianLifecycle('notification-demo',policy,'2026-11-06'));
 const path=join(directory,'reminders.sqlite3');let queue=await createSqliteReminderStore(path,'notification-demo'),now=1000000,failFirst=true;
 const visible=new Map();
 const source={read:async()=>{const v=getUsageGuidance(decodeGuardianLifecycle(await guardian.read()));return JSON.stringify({version:1,scopeId:v.lifecycleId,revision:v.revision,cycle:v.round,dayKey:v.dayKey,phase:v.phase,cycleRemainingSeconds:v.cycleRemainingSeconds,dailyRemainingSeconds:v.dailyRemainingSeconds,simulated:true});}};
 const port={authorization:async()=> 'authorized',publish:async(id,kind)=>{if(failFirst){failFirst=false;throw Error('synthetic submission failure');}visible.set(id,kind);console.log(JSON.stringify({operation:'recorded_publish',id,kind,nativeDeliveryValidated:false}));},cancel:async id=>{visible.delete(id);console.log(JSON.stringify({operation:'recorded_cancel',id}));}};
 const worker=ownerId=>new ReminderDelivery(queue,source,port,{scopeId:'notification-demo',ownerId,nowMs:()=>now,timeoutMs:5000});
 async function usage(seconds){const s=decodeGuardianLifecycle(await guardian.read());await commitGuardianCommand(guardian,{lifecycleId:s.lifecycleId,eventId:'sample-'+s.revision,expectedRevision:s.revision,type:'record_usage',payload:{seconds}});}
 await usage(1500);assert.equal((await worker('first').pump()).status,'retry_pending');queue=await openSqliteReminderStore(path);now+=1000;assert.equal((await worker('restart').pump()).status,'submitted');assert.deepEqual([...visible.entries()],[[1,'five_minutes']]);
 const before=await queue.read();assert.equal((await worker('restart').pump()).status,'idle');assert.equal(await queue.read(),before);
 await usage(240);await worker('restart').pump();assert.deepEqual([...visible.entries()],[[2,'one_minute']]);
 await usage(60);await worker('restart').pump();assert.deepEqual([...visible.entries()],[[3,'time_up']]);
 await worker('restart').pause();assert.equal(visible.size,0);assert.equal(decodeGuardianLifecycle(await guardian.read()).dailyUsageSeconds,1800);
 console.log('重开、同ID重试、去重和旧项取消通过；使用账本仍为1800秒，没有生成使用资格。');
}finally{rmSync(directory,{recursive:true,force:true});}
