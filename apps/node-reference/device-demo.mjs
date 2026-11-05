import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGuardianLifecycle,decodeGuardianLifecycle} from '../../shared/domain/guardian-lifecycle.mjs';
import {commitGuardianCommand} from '../../shared/domain/lifecycle-controller.mjs';
import {createUnsupportedDeviceControlAdapter,readGuardedUsageView} from '../../shared/domain/device-control.mjs';
import {createSqliteLifecycleStore,openSqliteLifecycleStore} from './sqlite-store.mjs';

const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const directory=mkdtempSync(join(tmpdir(),'beaa-device-demo-')),path=join(directory,'guardian.sqlite3');
const options={scopeId:'demo-managed-app-set',timeoutMs:5000};
const adapter=createUnsupportedDeviceControlAdapter(options.scopeId);
try{
 const store=await createSqliteLifecycleStore(path,createGuardianLifecycle('device-status-demo',policy,'2026-11-05'));
 async function show(label){
  const before=await store.read(),view=await readGuardedUsageView(store,adapter,options);
  assert.equal(await store.read(),before);assert.equal(view.device.deviceControlValidated,false);assert.equal(view.consistent,false);
  console.log(JSON.stringify({label,phase:view.rules.phase,dailySeconds:view.rules.dailySeconds,expectedRestriction:view.expectedRestriction,deviceStatus:view.device.status,observedRestriction:view.device.restriction,consistent:view.consistent,deviceControlValidated:view.device.deviceControlValidated}));
 }
 console.log('真实SQLite只读状态演示；使用输入为合成数据，设备适配器明确不支持，没有跨应用监控或限制。');
 await show('初始：业务允许不等于设备已解锁');
 const state=decodeGuardianLifecycle(await store.read());
 await commitGuardianCommand(store,{lifecycleId:state.lifecycleId,eventId:'synthetic-use-1',expectedRevision:state.revision,type:'record_usage',payload:{seconds:1800}});
 await show('合成周期到期：规则要求限制，设备仍未验证');
 const reopened=await openSqliteLifecycleStore(path);assert.equal(await reopened.read(),await store.read());
 console.log('重新打开账本一致；状态查询没有重置或改写账本。');
}finally{rmSync(directory,{recursive:true,force:true});}
