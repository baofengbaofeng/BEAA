import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,statSync,chmodSync,existsSync,writeFileSync,symlinkSync,linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn,execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createGuardianLifecycle,applyGuardianCommand,encodeGuardianLifecycle,decodeGuardianLifecycle,getGuardianSession } from '../shared/domain/guardian-lifecycle.mjs';
import { commitGuardianCommand } from '../shared/domain/lifecycle-controller.mjs';
import { getLearningStats } from '../shared/domain/learning-history.mjs';
import { SqliteStoreError,createSqliteLifecycleStore,openSqliteLifecycleStore } from '../apps/node-reference/sqlite-store.mjs';
import { bank,policy,freshGuardian,cmd,beginGuardian,answerCmd } from './helpers/guardian-fixture.mjs';
const writer=fileURLToPath(new URL('./helpers/sqlite-crash-writer.py',import.meta.url));
const rejected=(fn,code)=>assert.rejects(fn,e=>e instanceof SqliteStoreError && (!code || e.code===code));
async function fixture(fn,initial=freshGuardian()){
 const directory=mkdtempSync(join(tmpdir(),'beaa-sqlite-')),path=join(directory,'guardian.sqlite3');
 try{await fn({directory,path,initial});}finally{rmSync(directory,{recursive:true,force:true});}
}
function changeDb(path,sql){execFileSync('python3',['-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.commit(); c.close()',path,sql],{stdio:'pipe'});}
async function startWriter(path,text,mode){
 const child=spawn('python3',[writer,path,mode],{stdio:['pipe','pipe','pipe']});child.stdin.end(text);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Transaction writer did not reach its boundary'));},4000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Transaction writer exited before its boundary'));});
  child.stdout.once('data',data=>{clearTimeout(timer);data.toString().trim()==='ready'?resolve():reject(new Error('Unexpected transaction writer response'));});
 });return child;
}
async function killWriter(child){const exited=once(child,'exit');child.kill('SIGKILL');const [code,signal]=await exited;assert.equal(code,null);assert.equal(signal,'SIGKILL');}
function finalAnswerState(){let s=beginGuardian(freshGuardian());for(let i=0;i<4;i++)s=applyGuardianCommand(s,answerCmd(s)).state;return s;}
async function seedStore(path,initial){
 if(initial.revision===0)return createSqliteLifecycleStore(path,initial);
 const store=await createSqliteLifecycleStore(path,freshGuardian());let state=decodeGuardianLifecycle(await store.read());
 for(const [type,payload,context] of [['record_usage',{seconds:1800},{}],['begin_quiz',{knowledgePoints:[]},{bank}]]){await commitGuardianCommand(store,cmd(state,type,payload),context);state=decodeGuardianLifecycle(await store.read());}
 for(let i=0;i<4;i++){await commitGuardianCommand(store,answerCmd(state));state=decodeGuardianLifecycle(await store.read());}
 assert.deepEqual(state,initial);return store;
}

test('reference SQLite creates a private database and reopens the exact Unicode snapshot',async()=>{
 const initial=createGuardianLifecycle('家庭账本-1',policy,'2026-11-05');
 await fixture(async({directory})=>{
  const path=join(directory,'记录 ?#%.sqlite3'),store=await seedStore(path,initial),text=await store.read();
  assert.deepEqual(decodeGuardianLifecycle(text),initial);assert.equal(statSync(path).mode&0o777,0o600);
  const reopened=await openSqliteLifecycleStore(path);assert.equal(await reopened.read(),text);
 },initial);
});

test('create never overwrites an existing database and open never initializes a missing file',async()=>{
 await fixture(async({path,initial})=>{
  const store=await seedStore(path,initial),before=await store.read();
  await rejected(()=>createSqliteLifecycleStore(path,initial),'ALREADY_EXISTS');assert.equal(await store.read(),before);
  await rejected(()=>openSqliteLifecycleStore(path+'.missing'),'STORE_MISSING');assert.equal(existsSync(path+'.missing'),false);
 });
});

test('independent helper processes atomically compare revision and keep one winning snapshot',async()=>{
 await fixture(async({path,initial})=>{
  const store=await seedStore(path,initial),other=await openSqliteLifecycleStore(path),expected={lifecycleId:initial.lifecycleId,revision:0};
  const one=applyGuardianCommand(initial,cmd(initial,'record_usage',{seconds:1})).state,two=applyGuardianCommand(initial,cmd(initial,'record_usage',{seconds:2})).state;
  const results=await Promise.all([store.compareAndSwap(expected,encodeGuardianLifecycle(one)),other.compareAndSwap(expected,encodeGuardianLifecycle(two))]);
  assert.equal(results.filter(Boolean).length,1);const restored=decodeGuardianLifecycle(await store.read());
  assert.equal(restored.revision,1);assert.equal(getGuardianSession(restored).dailySeconds,results[0]?1:2);
 });
});

test('real SQLite controller competition stores exactly one final answer and archive',async()=>{
 await fixture(async({path,initial})=>{
  const store=await seedStore(path,initial),a=answerCmd(initial),b=answerCmd(initial,true);b.eventId='other-final-answer';
  const results=await Promise.allSettled([commitGuardianCommand(store,a),commitGuardianCommand(store,b)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='CONFLICT').length,1);
  const restored=decodeGuardianLifecycle(await store.read());assert.equal(getLearningStats(restored.history).quizCount,1);assert.equal(restored.revision,initial.revision+1);
 },finalAnswerState());
});

test('lost acknowledgement after an actual SQLite commit recovers as duplicate on reopen',async()=>{
 await fixture(async({path,initial})=>{
  const store=await seedStore(path,initial),event=answerCmd(initial),cas=store.compareAndSwap.bind(store);
  store.compareAndSwap=async(...args)=>{await cas(...args);throw new Error('Injected acknowledgement loss');};
  await assert.rejects(()=>commitGuardianCommand(store,event),e=>e.code==='STORE_FAILURE');
  const reopened=await openSqliteLifecycleStore(path),result=await commitGuardianCommand(reopened,event),restored=decodeGuardianLifecycle(await reopened.read());
  assert.equal(result.outcome,'duplicate');assert.equal(restored.stage.kind,'rest');assert.equal(getLearningStats(restored.history).quizCount,1);assert.equal(getGuardianSession(restored).dailySeconds,1800);
 },finalAnswerState());
});

test('SIGKILL before COMMIT rolls back the uncommitted phase and preserves the prior ledger',async()=>{
 await fixture(async({path,initial})=>{
  const store=await seedStore(path,initial),next=applyGuardianCommand(initial,answerCmd(initial)).state;
  const child=await startWriter(path,encodeGuardianLifecycle(next),'before_commit');await killWriter(child);
  const restored=decodeGuardianLifecycle(await (await openSqliteLifecycleStore(path)).read());assert.deepEqual(restored,initial);
  assert.equal(restored.stage.kind,'quiz');assert.equal(restored.history.records.length,0);assert.equal(getGuardianSession(restored).dailySeconds,1800);
 },finalAnswerState());
});

test('SIGKILL after COMMIT preserves the complete new phase, archive and receipt',async()=>{
 await fixture(async({path,initial})=>{
  await seedStore(path,initial);const event=answerCmd(initial),next=applyGuardianCommand(initial,event).state;
  const child=await startWriter(path,encodeGuardianLifecycle(next),'after_commit');await killWriter(child);
  const reopened=await openSqliteLifecycleStore(path),restored=decodeGuardianLifecycle(await reopened.read());assert.deepEqual(restored,next);
  assert.equal(restored.stage.kind,'rest');assert.equal(getLearningStats(restored.history).quizCount,1);assert.equal((await commitGuardianCommand(reopened,event)).outcome,'duplicate');
 },finalAnswerState());
});

test('a held real transaction returns STORE_BUSY without altering the stored snapshot',{timeout:15000},async()=>{
 await fixture(async({path,initial})=>{
  const store=await seedStore(path,initial),next=applyGuardianCommand(initial,cmd(initial,'record_usage',{seconds:60})).state;
  const child=await startWriter(path,'','hold');
  try{await rejected(()=>store.compareAndSwap({lifecycleId:initial.lifecycleId,revision:0},encodeGuardianLifecycle(next)),'STORE_BUSY');}
  finally{await killWriter(child);}
  assert.deepEqual(decodeGuardianLifecycle(await store.read()),initial);
 });
});

test('invalid snapshot metadata or a nonincrementing replacement never writes',async()=>{
 await fixture(async({path,initial})=>{
  const store=await seedStore(path,initial),before=await store.read();
  await rejected(()=>store.compareAndSwap({lifecycleId:initial.lifecycleId,revision:0},before),'INVALID_SNAPSHOT');
  await rejected(()=>store.compareAndSwap({lifecycleId:initial.lifecycleId,revision:0},'{bad'),'INVALID_SNAPSHOT');
  await rejected(()=>store.compareAndSwap({lifecycleId:initial.lifecycleId,revision:0,extra:true},before),'INVALID_REQUEST');
  const next=applyGuardianCommand(initial,cmd(initial,'record_usage',{seconds:1})).state;next.lifecycleId='other';next.lastReceipt.command.lifecycleId='other';
  await rejected(()=>store.compareAndSwap({lifecycleId:initial.lifecycleId,revision:0},encodeGuardianLifecycle(next)),'INVALID_SNAPSHOT');assert.equal(await store.read(),before);
 });
});

test('unsafe directory, database modes, symlinks and hard links fail without permission changes',async()=>{
 await fixture(async({directory,path,initial})=>{
  chmodSync(directory,0o755);await rejected(()=>createSqliteLifecycleStore(path,initial),'UNSAFE_STORAGE');assert.equal(existsSync(path),false);chmodSync(directory,0o700);
  await seedStore(path,initial);chmodSync(path,0o644);await rejected(()=>openSqliteLifecycleStore(path),'UNSAFE_STORAGE');assert.equal(statSync(path).mode&0o777,0o644);chmodSync(path,0o600);
  const symbolic=path+'.symbolic';symlinkSync(path,symbolic);await rejected(()=>openSqliteLifecycleStore(symbolic),'UNSAFE_STORAGE');
  const hard=path+'.hard';linkSync(path,hard);await rejected(()=>openSqliteLifecycleStore(hard),'UNSAFE_STORAGE');
 });
});

test('missing row, bad digest or unknown database schema never clears or recreates data',async()=>{
 for(const sql of ["DELETE FROM guardian_state","UPDATE guardian_state SET payload='{}'","UPDATE guardian_state SET lifecycle_id='mismatch'","PRAGMA user_version=2"]){
  await fixture(async({path,initial})=>{
   await seedStore(path,initial);changeDb(path,sql);const size=statSync(path).size;
   await rejected(()=>openSqliteLifecycleStore(path),sql.includes('user_version')?'UNSUPPORTED_STORE':'CORRUPT_STORE');assert.equal(statSync(path).size,size);
  });
 }
 await fixture(async({path})=>{writeFileSync(path,'not a SQLite database',{mode:0o600});await rejected(()=>openSqliteLifecycleStore(path),'CORRUPT_STORE');});
});

test('new stores reject imported noninitial revisions and backend launch/protocol failures',async()=>{
 await fixture(async({directory,path,initial})=>{
  const next=applyGuardianCommand(initial,cmd(initial,'record_usage',{seconds:1})).state;
  await rejected(()=>createSqliteLifecycleStore(path,next),'INVALID_SNAPSHOT');assert.equal(existsSync(path),false);
  await rejected(()=>createSqliteLifecycleStore(path,initial,{python:join(directory,'missing-python')}),'BACKEND_UNAVAILABLE');
  const broken=join(directory,'broken-backend');writeFileSync(broken,"#!/usr/bin/env python3\nimport sys\nsys.stderr.write('PRIVATE_TEST_SENTINEL')\nprint('invalid-response')\n",{mode:0o700});
  await assert.rejects(()=>createSqliteLifecycleStore(path,initial,{python:broken}),e=>e instanceof SqliteStoreError && e.code==='PROTOCOL_ERROR' && !e.message.includes('PRIVATE_TEST_SENTINEL'));
  assert.equal(existsSync(path),false);
 });
});

test('a stuck backend is killed after the bounded operation deadline',{timeout:15000},async()=>{
 await fixture(async({directory,path,initial})=>{
  const stuck=join(directory,'stuck-backend');writeFileSync(stuck,'#!/usr/bin/env python3\nimport time\ntime.sleep(60)\n',{mode:0o700});
  await rejected(()=>createSqliteLifecycleStore(path,initial,{python:stuck}),'STORE_TIMEOUT');assert.equal(existsSync(path),false);
 });
});


test('writable non-sticky or symbolic ancestors cannot redirect an otherwise private database',async()=>{
 await fixture(async({directory,initial})=>{
  const exposed=join(directory,'shared'),privateChild=join(exposed,'private');mkdirSync(exposed,{mode:0o700});chmodSync(exposed,0o777);mkdirSync(privateChild,{mode:0o700});
  const unsafe=join(privateChild,'guardian.sqlite3');await rejected(()=>createSqliteLifecycleStore(unsafe,initial),'UNSAFE_STORAGE');assert.equal(existsSync(unsafe),false);
  chmodSync(exposed,0o1777);await createSqliteLifecycleStore(unsafe,initial);assert.deepEqual(decodeGuardianLifecycle(await (await openSqliteLifecycleStore(unsafe)).read()),initial);
  const real=join(directory,'real'),nested=join(real,'nested');mkdirSync(real,{mode:0o700});mkdirSync(nested,{mode:0o700});
  const alias=join(directory,'alias');symlinkSync(real,alias);const symbolic=join(alias,'nested','guardian.sqlite3');
  await rejected(()=>createSqliteLifecycleStore(symbolic,initial),'UNSAFE_STORAGE');assert.equal(existsSync(join(nested,'guardian.sqlite3')),false);
 });
});
