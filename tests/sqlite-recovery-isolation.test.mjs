import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {invokePythonWorker} from '../apps/node-reference/python-worker.mjs';
import {createSqliteLifecycleStore,openSqliteLifecycleStore,inspectSqliteLifecycleBackup} from '../apps/node-reference/sqlite-store.mjs';
import {createParentAuthService,openParentAuthService} from '../apps/node-reference/parent-auth.mjs';
import {createSqliteQuestionBankStore,openSqliteQuestionBankStore} from '../apps/node-reference/question-bank-store.mjs';
import {createQuestionBankCatalog,decodeQuestionBankCatalog} from '../shared/quiz/catalog.mjs';
import {commitGuardianCommand} from '../shared/domain/lifecycle-controller.mjs';
import {decodeGuardianLifecycle,getGuardianView} from '../shared/domain/guardian-lifecycle.mjs';
import {freshGuardian,bank,cmd} from './helpers/guardian-fixture.mjs';
const PIN='482619',kinds=['guardian','auth','bank'];
const open={guardian:openSqliteLifecycleStore,auth:openParentAuthService,bank:openSqliteQuestionBankStore};
const unsupported=kind=>kind==='auth'?'UNSUPPORTED_AUTH_STORE':'UNSUPPORTED_STORE';
const fingerprint=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function metadata(path){return JSON.parse(execFileSync('python3',['-c',"import sqlite3,sys,json; c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); print(json.dumps(c.execute('SELECT credential_version,failures FROM parent_auth').fetchone())); c.close()",path],{encoding:'utf8'}));}
async function fixture(kind,fn){
 const directory=mkdtempSync(join(tmpdir(),'beaa-sqlite-isolation-')),path=join(directory,'state.sqlite3');
 try{
  let store,saved;
  if(kind==='guardian'){const initial=freshGuardian();store=await createSqliteLifecycleStore(path,initial);await commitGuardianCommand(store,cmd(initial,'record_usage',{seconds:1800}));saved=await store.read();}
  else if(kind==='auth'){store=await createParentAuthService(path,'family-ledger-1',PIN);for(let i=0;i<2;i++)await assert.rejects(store.login('000000'),e=>e.code==='PARENT_PIN_INVALID');saved=metadata(path);}
  else{store=await createSqliteQuestionBankStore(path,createQuestionBankCatalog('family-ledger-1',bank));saved=await store.read();}
  await fn({directory,path,store,saved});
 }finally{rmSync(directory,{recursive:true,force:true});}
}
function crash(path,kind){execFileSync('python3',['-B',new URL('./helpers/sqlite-hot-journal.py',import.meta.url).pathname,path,kind],{stdio:['ignore','pipe','pipe']});assert(existsSync(path+'-journal'),'fixture must leave a rollback journal');}
async function recovered(kind,path,saved){
 const store=await open[kind](path);
 if(kind==='auth'){assert.deepEqual(metadata(path),saved);const {token}=await store.login(PIN);assert.equal((await store.authorize(token)).credentialVersion,1);}
 else{assert.equal(await store.read(),saved);if(kind==='guardian'){const view=getGuardianView(decodeGuardianLifecycle(await store.read()));assert.equal(view.dailySeconds,1800);assert.equal(view.phase,'CHALLENGE_REQUIRED');}else assert.equal(decodeQuestionBankCatalog(await store.read()).revision,0);}
 assert.equal(existsSync(path+'-journal'),false);return store;
}

test('parent status reopens an interrupted PIN update and retains committed PIN, version and failure count',async()=>{
 await fixture('auth',async({path,saved})=>{assert.deepEqual(saved,[1,2]);crash(path,'auth');await recovered('auth',path,saved);});
});
for(const source of kinds)for(const reader of kinds.filter(kind=>kind!==source))test(`${reader} rejects a hot ${source} database before changing its files`,async()=>{
 await fixture(source,async({path,saved})=>{
  crash(path,source);const before=fingerprint(path),journal=fingerprint(path+'-journal');
  await assert.rejects(open[reader](path),e=>e.code===unsupported(reader));assert.equal(fingerprint(path),before,'foreign database bytes changed');assert.equal(fingerprint(path+'-journal'),journal,'foreign rollback journal changed');assert.equal(existsSync(path+'-wal'),false);assert.equal(existsSync(path+'-shm'),false);
  await recovered(source,path,saved);
 });
});
test('read-only guardian inspection preserves its hot journal until a normal open recovers it',async()=>{
 await fixture('guardian',async({path,saved})=>{crash(path,'guardian');const before=fingerprint(path),journal=fingerprint(path+'-journal');await assert.rejects(inspectSqliteLifecycleBackup(path));assert.equal(fingerprint(path),before);assert.equal(fingerprint(path+'-journal'),journal);await recovered('guardian',path,saved);assert.equal((await inspectSqliteLifecycleBackup(path)).revision,1);});
});
for(const kind of kinds)for(const pragma of ['PRAGMA user_version=2','PRAGMA journal_mode=WAL'])test(`${kind} refuses ${pragma} before creating auxiliary files`,async()=>{
 await fixture(kind,async({path})=>{execFileSync('python3',['-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.close()',path,pragma]);const before=fingerprint(path);await assert.rejects(open[kind](path),e=>e.code===unsupported(kind));assert.equal(fingerprint(path),before);assert.equal(existsSync(path+'-wal'),false);assert.equal(existsSync(path+'-shm'),false);});
});
const guardianWorker=fileURLToPath(new URL('../apps/node-reference/sqlite_worker.py',import.meta.url));
for(const source of ['auth','bank'])test(`backup dispatch rejects a hot ${source} source without creating a destination`,async()=>{
 await fixture(source,async({directory,path,saved})=>{
  crash(path,source);const before=fingerprint(path),journal=fingerprint(path+'-journal'),target=join(directory,'not-created.sqlite3');
  await assert.rejects(invokePythonWorker(guardianWorker,path,'python3',{operation:'backup',target}),e=>e.code==='UNSUPPORTED_STORE');
  assert.equal(existsSync(target),false);assert.equal(fingerprint(path),before);assert.equal(fingerprint(path+'-journal'),journal);await recovered(source,path,saved);
 });
});
test('the read-only backup phase preserves a hot source and creates no target until normal recovery',async()=>{
 await fixture('guardian',async({directory,path,saved})=>{
  crash(path,'guardian');const before=fingerprint(path),journal=fingerprint(path+'-journal'),target=join(directory,'checkpoint.sqlite3');
  await assert.rejects(invokePythonWorker(guardianWorker,path,'python3',{operation:'backup',target}),e=>e.code==='STORE_IO');assert.equal(existsSync(target),false);assert.equal(fingerprint(path),before);assert.equal(fingerprint(path+'-journal'),journal);
  const store=await recovered('guardian',path,saved),backup=await store.backup(target);assert.equal(backup.revision,1);assert.equal(await (await openSqliteLifecycleStore(target)).read(),saved);
 });
});
