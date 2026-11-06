import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqliteLifecycleStore,openSqliteLifecycleStore} from '../apps/node-reference/sqlite-store.mjs';
import {readGuardedUsageView,createUnsupportedDeviceControlAdapter} from '../shared/domain/device-control.mjs';
import {commitGuardianCommand} from '../shared/domain/lifecycle-controller.mjs';
import {decodeGuardianLifecycle,getGuardianView} from '../shared/domain/guardian-lifecycle.mjs';
import {freshGuardian,cmd} from './helpers/guardian-fixture.mjs';
const scopeId='test-managed-set',options={scopeId,timeoutMs:5000};

test('real SQLite read-only device diagnostics preserve the full ledger on reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'beaa-device-read-'));
 try{
  const path=join(dir,'state.sqlite3'),store=await createSqliteLifecycleStore(path,freshGuardian()),before=await store.read();
  const view=await readGuardedUsageView(store,createUnsupportedDeviceControlAdapter(scopeId),options);
  assert.equal(view.rules.phase,'AVAILABLE');assert.equal(view.device.status,'unsupported');assert.equal(view.device.deviceControlValidated,false);assert.equal(view.consistent,false);
  assert.equal(await (await openSqliteLifecycleStore(path)).read(),before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('a real concurrent SQLite daily-limit commit makes the device view stale without rollback',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'beaa-device-race-'));
 try{
  const path=join(dir,'state.sqlite3'),initial=freshGuardian(),store=await createSqliteLifecycleStore(path,initial);
  const adapter={
   getCapabilities:()=>({schemaVersion:1,scopeId,revision:0,usage:'supported',restriction:'supported',authorization:'authorized'}),
   async getRestrictionStatus(){await commitGuardianCommand(store,cmd(initial,'record_usage',{seconds:7200}));return {schemaVersion:1,scopeId,revision:0,status:'ok',state:'released'};}
  };
  await assert.rejects(readGuardedUsageView(store,adapter,options),error=>error.code==='LIFECYCLE_CHANGED');
  const recovered=decodeGuardianLifecycle(await (await openSqliteLifecycleStore(path)).read());assert.equal(recovered.revision,1);assert.equal(getGuardianView(recovered).phase,'DAILY_LOCKED');assert.equal(getGuardianView(recovered).dailySeconds,7200);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
