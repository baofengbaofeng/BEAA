import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createSqliteReminderStore,openSqliteReminderStore} from '../apps/node-reference/reminder-store.mjs';
import {createSqliteLifecycleStore,openSqliteLifecycleStore} from '../apps/node-reference/sqlite-store.mjs';
import {createParentAuthService,openParentAuthService} from '../apps/node-reference/parent-auth.mjs';
import {createSqliteQuestionBankStore,openSqliteQuestionBankStore} from '../apps/node-reference/question-bank-store.mjs';
import {createQuestionBankCatalog} from '../shared/quiz/catalog.mjs';
import {freshGuardian,bank} from './helpers/guardian-fixture.mjs';
import {loadNativeCore} from './helpers/native-core.mjs';
const {ReminderDelivery,createReminderQueue}=loadNativeCore(['ReminderDelivery']);
const snapshot={version:1,scopeId:'family',revision:1,cycle:0,dayKey:'2026-11-06',phase:'AVAILABLE',cycleRemainingSeconds:300,dailyRemainingSeconds:7200,simulated:true};
function runner(store,visible,calls,owner='worker') {return new ReminderDelivery(store,{read:async()=>JSON.stringify(snapshot)},{authorization:async()=> 'authorized',publish:async(id,kind)=>{calls.push(id);visible.set(id,kind);},cancel:async id=>{visible.delete(id);}},{scopeId:'family',ownerId:owner,nowMs:()=>1000000,timeoutMs:5000});}
const temp=()=>mkdtempSync(join(tmpdir(),'beaa-reminder-db-'));
test('actual SQLite delivery queue reopens without replaying a published warning',async()=>{
 const dir=temp();try{const path=join(dir,'queue.sqlite3'),store=await createSqliteReminderStore(path,'family'),visible=new Map(),calls=[];assert.equal((await runner(store,visible,calls).pump()).status,'submitted');const saved=await store.read(),reopened=await openSqliteReminderStore(path);assert.equal(await reopened.read(),saved);assert.equal((await runner(reopened,visible,calls,'restart').pump()).status,'idle');assert.deepEqual(calls,[1]);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('independent real SQLite helpers atomically compare both scope and queue revision',async()=>{
 const dir=temp();try{const path=join(dir,'queue.sqlite3'),a=await createSqliteReminderStore(path,'family'),b=await openSqliteReminderStore(path),one=JSON.parse(createReminderQueue('family')),two=JSON.parse(createReminderQueue('family'));one.revision=1;one.lastClockMs=1;two.revision=1;two.lastClockMs=2;const results=await Promise.all([a.compareAndSwap('family',0,JSON.stringify(one)),b.compareAndSwap('family',0,JSON.stringify(two))]);assert.equal(results.filter(Boolean).length,1);assert.equal(JSON.parse(await a.read()).lastClockMs,results[0]?1:2);assert.equal(await a.compareAndSwap('other',1,JSON.stringify({...one,scopeId:'other',revision:2})),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('a lost reply after real SQLite publication acknowledgement recovers from durable state',async()=>{
 const dir=temp();try{const path=join(dir,'queue.sqlite3'),store=await createSqliteReminderStore(path,'family'),calls=[],visible=new Map();let lost=false;const wrapped={read:()=>store.read(),compareAndSwap:async(...args)=>{const ok=await store.compareAndSwap(...args);if(ok&&!lost&&JSON.parse(args[2]).items.some(i=>i.status==='published')){lost=true;throw Error('reply lost');}return ok;}};await assert.rejects(runner(wrapped,visible,calls).pump(),e=>e.code==='STORE_FAILURE');assert.equal((await runner(await openSqliteReminderStore(path),visible,calls,'restart').pump()).status,'idle');assert.deepEqual(calls,[1]);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('hot queue journals are rejected unchanged by other owners then recovered by the correct store',async()=>{
 const dir=temp();try{const path=join(dir,'queue.sqlite3'),store=await createSqliteReminderStore(path,'family');await runner(store,new Map(),[]).pump();const expected=await store.read();execFileSync('python3',['tests/helpers/sqlite-hot-journal.py',path,'reminder']);const db=readFileSync(path),journal=readFileSync(path+'-journal');for(const open of [openSqliteLifecycleStore,openParentAuthService,openSqliteQuestionBankStore]){await assert.rejects(open(path));assert.deepEqual(readFileSync(path),db);assert.deepEqual(readFileSync(path+'-journal'),journal);}assert.equal(await (await openSqliteReminderStore(path)).read(),expected);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('queue storage rejects all other database formats before opening them',async()=>{
 const dir=temp();try{const paths=[join(dir,'g.sqlite3'),join(dir,'a.sqlite3'),join(dir,'b.sqlite3')];await createSqliteLifecycleStore(paths[0],freshGuardian());await createParentAuthService(paths[1],'family','839271');await createSqliteQuestionBankStore(paths[2],createQuestionBankCatalog('family',bank));for(const path of paths){const before=readFileSync(path);await assert.rejects(openSqliteReminderStore(path),e=>e.code==='UNSUPPORTED_STORE');assert.deepEqual(readFileSync(path),before);}}finally{rmSync(dir,{recursive:true,force:true});}
});
test('queue open never initializes or overwrites missing, corrupt or unsafe stores',async()=>{
 const dir=temp();try{const path=join(dir,'queue.sqlite3');await assert.rejects(openSqliteReminderStore(path),e=>e.code==='STORE_MISSING');const store=await createSqliteReminderStore(path,'family');await assert.rejects(createSqliteReminderStore(path,'family'),e=>e.code==='ALREADY_EXISTS');await assert.rejects(store.compareAndSwap('family',0,'{broken'));chmodSync(path,0o644);await assert.rejects(openSqliteReminderStore(path),e=>e.code==='UNSAFE_STORAGE');}finally{rmSync(dir,{recursive:true,force:true});}
});
