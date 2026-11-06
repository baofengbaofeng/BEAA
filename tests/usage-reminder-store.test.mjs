import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqliteLifecycleStore,openSqliteLifecycleStore} from '../apps/node-reference/sqlite-store.mjs';
import {decodeGuardianLifecycle} from '../shared/domain/guardian-lifecycle.mjs';
import {commitGuardianCommand} from '../shared/domain/lifecycle-controller.mjs';
import {getUsageReminderEvent,readUsageGuidance} from '../shared/domain/usage-reminders.mjs';
import {freshGuardian,cmd} from './helpers/guardian-fixture.mjs';

test('committed SQLite boundaries survive reopening and guidance never writes a new revision',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'beaa-reminder-store-')),path=join(directory,'ledger.sqlite3');
 try{
  let store=await createSqliteLifecycleStore(path,freshGuardian());
  for(const [seconds,kind,remaining] of [[1499,null,301],[1,'five_minutes',300],[240,'one_minute',60],[60,'time_up',0]]){
   const before=decodeGuardianLifecycle(await store.read()),command=cmd(before,'record_usage',{seconds});
   assert.equal((await commitGuardianCommand(store,command)).outcome,'committed');
   const captured=await store.read(),after=decodeGuardianLifecycle(captured),event=getUsageReminderEvent(before,after);
   assert.equal(event?.kind??null,kind);store=await openSqliteLifecycleStore(path);
   assert.equal((await readUsageGuidance({read:()=>store.read(),compareAndSwap(){throw Error('unexpected write');}})).remainingUsageSeconds,remaining);
   assert.equal(await store.read(),captured);assert.deepEqual(getUsageReminderEvent(before,decodeGuardianLifecycle(await store.read())),event);
   assert.equal((await commitGuardianCommand(store,command)).outcome,'duplicate');assert.equal(await store.read(),captured);
  }
  assert.equal((await readUsageGuidance(store)).phase,'CHALLENGE_REQUIRED');
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('SQLite reminders obey an earlier daily cap and a stale commit cannot produce a new snapshot',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'beaa-reminder-daily-')),path=join(directory,'ledger.sqlite3');
 try{
  const store=await createSqliteLifecycleStore(path,freshGuardian({dailyLimitMinutes:15}));
  const initial=decodeGuardianLifecycle(await store.read()),stale=cmd(initial,'record_usage',{seconds:1});stale.eventId='stale-sample';
  for(const [seconds,kind] of [[600,'five_minutes'],[240,'one_minute'],[60,'time_up']]){
   const before=decodeGuardianLifecycle(await store.read());await commitGuardianCommand(store,cmd(before,'record_usage',{seconds}));
   const event=getUsageReminderEvent(before,decodeGuardianLifecycle(await store.read()));assert.equal(event.kind,kind);assert.equal(event.limitingRule,'daily_limit');
  }
  const saved=await store.read();await assert.rejects(commitGuardianCommand(store,stale),e=>e.code==='CONFLICT');assert.equal(await store.read(),saved);
  const view=await readUsageGuidance(await openSqliteLifecycleStore(path));assert.equal(view.phase,'DAILY_LOCKED');assert.equal(view.dailyUsedSeconds,900);assert.equal(view.cycleRemainingSeconds,900);assert.equal(view.remainingUsageSeconds,0);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
