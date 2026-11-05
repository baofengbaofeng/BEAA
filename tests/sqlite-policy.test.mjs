import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSqliteLifecycleStore,openSqliteLifecycleStore,inspectSqliteLifecycleBackup } from '../apps/node-reference/sqlite-store.mjs';
import { createParentAuthService } from '../apps/node-reference/parent-auth.mjs';
import { commitGuardianCommand } from '../shared/domain/lifecycle-controller.mjs';
import { commitParentPolicyChange } from '../shared/domain/parent-policy.mjs';
import { decodeGuardianLifecycle,getGuardianView } from '../shared/domain/guardian-lifecycle.mjs';
import { freshGuardian,cmd } from './helpers/guardian-fixture.mjs';
const PIN='482619';
async function fixture(fn){
 const directory=mkdtempSync(join(tmpdir(),'beaa-parent-policy-')),path=join(directory,'guardian.sqlite3'),initial=freshGuardian();
 try{const store=await createSqliteLifecycleStore(path,initial),auth=await createParentAuthService(join(directory,'parent.sqlite3'),initial.lifecycleId,PIN);await fn({directory,path,store,auth,initial});}finally{rmSync(directory,{recursive:true,force:true});}
}
const settings=(s,changes)=>cmd(s,'set_policy',{policy:{...s.policy,...changes}});

test('real PIN-authorized SQLite policy writes preserve over-cap usage through reopen',async()=>{
 await fixture(async({directory,path,store,auth,initial})=>{
  await commitGuardianCommand(store,cmd(initial,'record_usage',{seconds:1200}));let state=decodeGuardianLifecycle(await store.read());
  await assert.rejects(()=>commitParentPolicyChange(store,auth,null,settings(state,{dailyLimitMinutes:15})),e=>e.code==='PARENT_UNAUTHORIZED');
  const {token}=await auth.login(PIN);let result=await commitParentPolicyChange(store,auth,token,settings(state,{dailyLimitMinutes:15}));
  assert.equal(result.phase,'DAILY_LOCKED');assert.equal(result.dailySeconds,1200);const reopened=await openSqliteLifecycleStore(path);state=decodeGuardianLifecycle(await reopened.read());
  assert.equal(state.dailyUsageSeconds,1200);assert.equal(state.stage.session.dailySeconds,900);
  result=await commitParentPolicyChange(reopened,auth,token,settings(state,{dailyLimitMinutes:45}));assert.equal(result.phase,'AVAILABLE');assert.equal(result.dailySeconds,1200);
  const target=join(directory,'policy-backup.sqlite3'),backup=await reopened.backup(target);assert.deepEqual(await inspectSqliteLifecycleBackup(target),backup);
  auth.logout(token);state=decodeGuardianLifecycle(await reopened.read());const before=await reopened.read();
  await assert.rejects(()=>commitParentPolicyChange(reopened,auth,token,settings(state,{dailyLimitMinutes:60})),e=>e.code==='PARENT_UNAUTHORIZED');assert.equal(await reopened.read(),before);
 });
});

test('legacy SQLite payload is read and backed up unchanged, then upgrades only on acknowledged CAS',async()=>{
 await fixture(async({directory,path,store,auth,initial})=>{
  await commitGuardianCommand(store,cmd(initial,'record_usage',{seconds:60}));const state=decodeGuardianLifecycle(await store.read());
  const {policy,dailyUsageSeconds,pendingPolicy,...old}=structuredClone(state),legacy=JSON.stringify({...old,schemaVersion:1});
  // Test-only old-format fixture: emulate the previous writer, preserving row identity/revision.
  execFileSync('python3',['-c',"import sqlite3,sys,hashlib; t=sys.stdin.read(); c=sqlite3.connect(sys.argv[1]); c.execute('UPDATE guardian_state SET payload=?,sha256=? WHERE id=1',(t,hashlib.sha256(t.encode()).hexdigest())); c.commit(); c.close()",path],{input:legacy,stdio:['pipe','pipe','pipe']});
  const reopened=await openSqliteLifecycleStore(path);assert.equal(await reopened.read(),legacy);const normalized=decodeGuardianLifecycle(await reopened.read());assert.equal(normalized.schemaVersion,2);assert.equal(normalized.revision,state.revision);assert.equal(normalized.dailyUsageSeconds,60);
  const target=join(directory,'legacy-backup.sqlite3');await reopened.backup(target);await inspectSqliteLifecycleBackup(target);assert.equal(await (await openSqliteLifecycleStore(target)).read(),legacy);assert.equal(await reopened.read(),legacy);
  const {token}=await auth.login(PIN);await commitParentPolicyChange(reopened,auth,token,settings(normalized,{restMinutes:15}));
  const committed=JSON.parse(await reopened.read());assert.equal(committed.schemaVersion,2);assert.equal(committed.revision,state.revision+1);assert.equal(committed.dailyUsageSeconds,60);assert.equal(committed.round,state.round);
  assert.equal(await (await openSqliteLifecycleStore(target)).read(),legacy);
 });
});

test('actual policy commit with lost acknowledgement retries once and later revocation cannot write',async()=>{
 await fixture(async({path,store,auth,initial})=>{
  const {token}=await auth.login(PIN),event=settings(initial,{requiredCorrect:4}),cas=store.compareAndSwap.bind(store);
  store.compareAndSwap=async(...args)=>{await cas(...args);throw new Error('injected lost acknowledgement');};
  await assert.rejects(()=>commitParentPolicyChange(store,auth,token,event),e=>e.code==='STORE_FAILURE');
  const reopened=await openSqliteLifecycleStore(path),result=await commitParentPolicyChange(reopened,auth,token,event);assert.equal(result.outcome,'duplicate');assert.equal(result.revision,1);
  const state=decodeGuardianLifecycle(await reopened.read());assert.equal(state.policy.requiredCorrect,4);assert.equal(getGuardianView(state).dailySeconds,0);
  await auth.changePin(token,'739152');await assert.rejects(()=>commitParentPolicyChange(reopened,auth,token,settings(state,{requiredCorrect:5})),e=>e.code==='PARENT_UNAUTHORIZED');assert.equal(decodeGuardianLifecycle(await reopened.read()).revision,1);
 });
});
