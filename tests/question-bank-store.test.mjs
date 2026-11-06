import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,existsSync,chmodSync,symlinkSync,linkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createSqliteQuestionBankStore,openSqliteQuestionBankStore} from '../apps/node-reference/question-bank-store.mjs';
import {createSqliteLifecycleStore,openSqliteLifecycleStore} from '../apps/node-reference/sqlite-store.mjs';
import {createParentAuthService,openParentAuthService} from '../apps/node-reference/parent-auth.mjs';
import {createQuestionBankCatalog,encodeQuestionBankCatalog,decodeQuestionBankCatalog,applyQuestionBankImport} from '../shared/quiz/catalog.mjs';
import {commitParentQuestionBank,beginQuizFromQuestionBank} from '../shared/domain/question-bank-service.mjs';
import {commitGuardianCommand} from '../shared/domain/lifecycle-controller.mjs';
import {decodeGuardianLifecycle,getGuardianView} from '../shared/domain/guardian-lifecycle.mjs';
import {freshGuardian,bank,cmd,answerCmd} from './helpers/guardian-fixture.mjs';
const PIN='482619';
async function fixture(fn){const directory=mkdtempSync(join(tmpdir(),'beaa-bank-')),path=join(directory,'bank.sqlite3'),initial=createQuestionBankCatalog('family-ledger-1',bank);try{const store=await createSqliteQuestionBankStore(path,initial);await fn({directory,path,initial,store});}finally{rmSync(directory,{recursive:true,force:true});}}
const event=(s,content=bank,id='bank-import-'+s.revision)=>({lifecycleId:s.lifecycleId,eventId:id,expectedRevision:s.revision,type:'replace_bank',payload:{bank:structuredClone(content)}});

test('a private SQLite catalog reopens exact Unicode content and never overwrites existing files',async()=>{
 await fixture(async({directory,path,initial,store})=>{const text=await store.read();assert.equal(decodeQuestionBankCatalog(text).bank.questions[0].stem,bank.questions[0].stem);assert.equal(statSync(path).mode&0o777,0o600);assert.equal(await (await openSqliteQuestionBankStore(path)).read(),text);await assert.rejects(createSqliteQuestionBankStore(path,initial),e=>e.code==='ALREADY_EXISTS');await assert.rejects(openSqliteQuestionBankStore(join(directory,'missing.sqlite3')),e=>e.code==='STORE_MISSING');assert.equal(await store.read(),text);});
});
test('independent helper processes keep exactly one winning catalog CAS',async()=>{
 await fixture(async({path,store,initial})=>{const other=await openSqliteQuestionBankStore(path),a=applyQuestionBankImport(initial,event(initial,bank,'writer-a')).state,b=applyQuestionBankImport(initial,event(initial,bank,'writer-b')).state;const results=await Promise.all([store.compareAndSwap({lifecycleId:initial.lifecycleId,revision:0},encodeQuestionBankCatalog(a)),other.compareAndSwap({lifecycleId:initial.lifecycleId,revision:0},encodeQuestionBankCatalog(b))]);assert.deepEqual(results.sort(),[false,true]);const saved=decodeQuestionBankCatalog(await store.read());assert.equal(saved.revision,1);assert(['writer-a','writer-b'].includes(saved.lastImport.eventId));});
});
test('real PIN-authenticated import persists across reopen and revoked tokens cannot change the catalog',async()=>{
 await fixture(async({directory,path,store,initial})=>{const authPath=join(directory,'auth.sqlite3'),auth=await createParentAuthService(authPath,initial.lifecycleId,PIN),before=await store.read();await assert.rejects(commitParentQuestionBank(store,auth,null,event(initial)),e=>e.code==='PARENT_UNAUTHORIZED');assert.equal(await store.read(),before);const {token}=await auth.login(PIN),changed=structuredClone(bank);changed.questions[0].stem='新题目：36 ÷ 4 + 7 = ?';const result=await commitParentQuestionBank(store,auth,token,event(initial,changed));assert.equal(result.revision,1);const reopened=await openSqliteQuestionBankStore(path);assert.equal(decodeQuestionBankCatalog(await reopened.read()).bank.questions[0].stem,changed.questions[0].stem);assert.equal((await commitParentQuestionBank(reopened,auth,token,event(initial,changed))).outcome,'duplicate');const otherAuth=await openParentAuthService(authPath),{token:otherToken}=await otherAuth.login(PIN);await otherAuth.changePin(otherToken,'739152');const saved=decodeQuestionBankCatalog(await reopened.read());await assert.rejects(commitParentQuestionBank(reopened,auth,token,event(saved)),e=>e.code==='PARENT_UNAUTHORIZED');assert.equal(decodeQuestionBankCatalog(await reopened.read()).revision,1);});
});
test('actual committed import with lost acknowledgement remains one version on retry',async()=>{
 await fixture(async({directory,path,store,initial})=>{const auth=await createParentAuthService(join(directory,'auth.sqlite3'),initial.lifecycleId,PIN),{token}=await auth.login(PIN),cas=store.compareAndSwap.bind(store),command=event(initial);store.compareAndSwap=async(...args)=>{await cas(...args);throw Error('lost ack');};await assert.rejects(commitParentQuestionBank(store,auth,token,command),e=>e.code==='STORE_FAILURE');const reopened=await openSqliteQuestionBankStore(path);assert.equal((await commitParentQuestionBank(reopened,auth,token,command)).outcome,'duplicate');assert.equal(decodeQuestionBankCatalog(await reopened.read()).revision,1);});
});
test('real catalog replacement does not rewrite a running quiz or its pinned grading',async()=>{
 await fixture(async({directory,store,initial})=>{const guardian=freshGuardian(),ledger=await createSqliteLifecycleStore(join(directory,'ledger.sqlite3'),guardian);await commitGuardianCommand(ledger,cmd(guardian,'record_usage',{seconds:1800}));let state=decodeGuardianLifecycle(await ledger.read());await beginQuizFromQuestionBank(ledger,store,cmd(state,'begin_quiz',{knowledgePoints:[]}));const pinned=await ledger.read();const auth=await createParentAuthService(join(directory,'auth.sqlite3'),initial.lifecycleId,PIN),{token}=await auth.login(PIN),changed=structuredClone(bank);for(const q of changed.questions){q.stem='新版 '+q.stem;q.correctOptionId=q.options.find(o=>o.id!==q.correctOptionId).id;}await commitParentQuestionBank(store,auth,token,event(initial,changed));assert.equal(await ledger.read(),pinned);while(getGuardianView(state=decodeGuardianLifecycle(await ledger.read())).question)await commitGuardianCommand(ledger,answerCmd(state));assert.equal(getGuardianView(decodeGuardianLifecycle(await ledger.read())).phase,'REST_REQUIRED');assert.equal(decodeGuardianLifecycle(await ledger.read()).history.records.length,1);});
});
test('bad replacements and another database format never initialize or reset a bank',async()=>{
 await fixture(async({directory,path,initial,store})=>{const before=await store.read();await assert.rejects(store.compareAndSwap({lifecycleId:initial.lifecycleId,revision:0},before),e=>e.code==='INVALID_SNAPSHOT');await assert.rejects(store.compareAndSwap({lifecycleId:'other',revision:0},encodeQuestionBankCatalog(applyQuestionBankImport(initial,event(initial)).state)),e=>e.code==='INVALID_SNAPSHOT');const ledgerPath=join(directory,'ledger.sqlite3');await createSqliteLifecycleStore(ledgerPath,freshGuardian());await assert.rejects(openSqliteQuestionBankStore(ledgerPath),e=>e.code==='UNSUPPORTED_STORE');await assert.rejects(openSqliteLifecycleStore(path),e=>e.code==='UNSUPPORTED_STORE');assert.equal(await store.read(),before);});
});
test('digest damage and structurally invalid stored bank data fail without clearing the file',async()=>{
 await fixture(async({path})=>{execFileSync('python3',['-c',"import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"UPDATE question_bank SET sha256=? WHERE id=1\",('0'*64,)); c.commit(); c.close()",path]);const before=readFileSync(path);await assert.rejects(openSqliteQuestionBankStore(path),e=>e.code==='CORRUPT_STORE');assert.deepEqual(readFileSync(path),before);});
 await fixture(async({path})=>{execFileSync('python3',['-c',"import sqlite3,sys,json,hashlib; c=sqlite3.connect(sys.argv[1]); t=json.loads(c.execute('SELECT payload FROM question_bank').fetchone()[0]); t['bank']['questions']=[]; s=json.dumps(t); c.execute('UPDATE question_bank SET payload=?,sha256=?',(s,hashlib.sha256(s.encode()).hexdigest())); c.commit(); c.close()",path]);const before=readFileSync(path);await assert.rejects(openSqliteQuestionBankStore(path),e=>e.code==='CORRUPT_STORE');assert.deepEqual(readFileSync(path),before);});
});
test('unsafe database permissions, symlinks and hardlinks are rejected without chmod',async()=>{
 await fixture(async({directory,path})=>{chmodSync(path,0o644);await assert.rejects(openSqliteQuestionBankStore(path),e=>e.code==='UNSAFE_STORAGE');assert.equal(statSync(path).mode&0o777,0o644);chmodSync(path,0o600);const linked=join(directory,'linked.sqlite3');symlinkSync(path,linked);await assert.rejects(openSqliteQuestionBankStore(linked),e=>e.code==='UNSAFE_STORAGE');rmSync(linked);linkSync(path,linked);await assert.rejects(openSqliteQuestionBankStore(linked),e=>e.code==='UNSAFE_STORAGE');await assert.rejects(openSqliteQuestionBankStore(path),e=>e.code==='UNSAFE_STORAGE');});
});
test('a killed import with spilled pages recovers the exact committed catalog through the API',async()=>{
 await fixture(async({path,initial,store})=>{
  const before=await store.read(),large=structuredClone(bank);large.questions=Array.from({length:80},(_,i)=>({...structuredClone(bank.questions[0]),id:'spill-'+i,stem:'测试'.repeat(900)}));
  const next=applyQuestionBankImport(initial,event(initial,large)).state,text=encodeQuestionBankCatalog(next);
  execFileSync('python3',['-c',"import sqlite3,sys,hashlib,os; t=sys.stdin.read(); c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA cache_size=1'); c.execute('BEGIN IMMEDIATE'); c.execute('UPDATE question_bank SET revision=1,payload=?,sha256=?',(t,hashlib.sha256(t.encode()).hexdigest())); os._exit(0)",path],{input:text});
  assert(existsSync(path+'-journal'),'test must produce a rollback journal');
  const reopened=await openSqliteQuestionBankStore(path);assert.equal(await reopened.read(),before);assert.equal(existsSync(path+'-journal'),false);
  assert.equal(await reopened.compareAndSwap({lifecycleId:initial.lifecycleId,revision:0},text),true);assert.equal(decodeQuestionBankCatalog(await (await openSqliteQuestionBankStore(path)).read()).revision,1);
 });
});
test('opening another application hot-journal database never recovers or changes its files',async()=>{
 await fixture(async({directory})=>{
  const path=join(directory,'foreign.sqlite3'),ledger=await createSqliteLifecycleStore(path,freshGuardian()),committed=await ledger.read();
  execFileSync('python3',['-c',"import sqlite3,sys,os; c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA cache_size=1'); c.execute('BEGIN IMMEDIATE'); c.execute('UPDATE guardian_state SET payload=?',('x'*200000,)); os._exit(0)",path]);
  assert(existsSync(path+'-journal'));const before=readFileSync(path),journal=readFileSync(path+'-journal');await assert.rejects(openSqliteQuestionBankStore(path),e=>e.code==='UNSUPPORTED_STORE');assert.deepEqual(readFileSync(path),before);assert.deepEqual(readFileSync(path+'-journal'),journal);
  assert.equal(await (await openSqliteLifecycleStore(path)).read(),committed);
 });
});
test('unsupported schema versions and WAL headers are rejected without changing database files',async()=>{
 for(const pragma of ['PRAGMA user_version=2','PRAGMA journal_mode=WAL'])await fixture(async({path})=>{
  execFileSync('python3',['-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.close()',path,pragma]);
  const before=readFileSync(path);await assert.rejects(openSqliteQuestionBankStore(path),e=>e.code==='UNSUPPORTED_STORE');assert.deepEqual(readFileSync(path),before);assert.equal(existsSync(path+'-wal'),false);assert.equal(existsSync(path+'-shm'),false);
 });
});
