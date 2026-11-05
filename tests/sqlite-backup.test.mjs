import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,chmodSync,rmSync,readFileSync,writeFileSync,statSync,existsSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn,spawnSync,execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createSqliteLifecycleStore,openSqliteLifecycleStore,inspectSqliteLifecycleBackup,SqliteStoreError } from '../apps/node-reference/sqlite-store.mjs';
import { applyGuardianCommand,decodeGuardianLifecycle,encodeGuardianLifecycle,getGuardianSession } from '../shared/domain/guardian-lifecycle.mjs';
import { commitGuardianCommand } from '../shared/domain/lifecycle-controller.mjs';
import { freshGuardian,cmd,bank,answerCmd } from './helpers/guardian-fixture.mjs';
const writer=fileURLToPath(new URL('./helpers/sqlite-crash-writer.py',import.meta.url));
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const rejected=(fn,code)=>assert.rejects(fn,e=>e instanceof SqliteStoreError && (!code || e.code===code));
async function fixture(fn){
 const directory=mkdtempSync(join(tmpdir(),'beaa-backup-')),source=join(directory,'source.sqlite3'),target=join(directory,'备份 ?#%.sqlite3'),initial=freshGuardian();
 try{const store=await createSqliteLifecycleStore(source,initial);await fn({directory,source,target,initial,store});}finally{rmSync(directory,{recursive:true,force:true});}
}
async function uncommittedWriter(source,text){
 const child=spawn('python3',[writer,source,'before_commit'],{stdio:['pipe','pipe','pipe']});child.stdin.end(text);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Writer did not start'));},4000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Writer exited'));});child.stdout.once('data',data=>{clearTimeout(timer);data.toString().trim()==='ready'?resolve():reject(new Error('Unexpected writer response'));});});return child;
}
async function killWriter(child){const exit=once(child,'exit');child.kill('SIGKILL');await exit;}
function changeDb(path,sql){execFileSync('python3',['-c','import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.commit(); c.close()',path,sql],{stdio:'pipe'});}

test('online backup preserves the full rest/archive snapshot and only returns metadata',async()=>{
 await fixture(async({source,target,store})=>{
  let s=decodeGuardianLifecycle(await store.read());
  for(const [type,payload,context] of [['record_usage',{seconds:1800},{}],['begin_quiz',{knowledgePoints:[]},{bank}]]){await commitGuardianCommand(store,cmd(s,type,payload),context);s=decodeGuardianLifecycle(await store.read());}
  for(let i=0;i<5;i++){await commitGuardianCommand(store,answerCmd(s));s=decodeGuardianLifecycle(await store.read());}
  const before=await store.read(),metadata=await store.backup(target),copy=await openSqliteLifecycleStore(target);
  assert.equal(await copy.read(),before);assert.equal(await store.read(),before);assert.equal(statSync(target).mode&0o777,0o600);
  assert.deepEqual(metadata,{lifecycleId:s.lifecycleId,revision:s.revision,snapshotSha256:sha(before)});
  assert.equal(decodeGuardianLifecycle(await copy.read()).history.records.length,1);assert.equal(getGuardianSession(s).phase,'REST_REQUIRED');
  assert.equal(JSON.stringify(metadata).includes('correctOptionId'),false);assert.ok(existsSync(source));
 });
});

test('an uncommitted external writer is excluded from the online backup',async()=>{
 await fixture(async({source,target,store,initial})=>{
  const next=applyGuardianCommand(initial,cmd(initial,'record_usage',{seconds:1800})).state,child=await uncommittedWriter(source,encodeGuardianLifecycle(next));
  try{const metadata=await store.backup(target);assert.equal(metadata.revision,0);assert.deepEqual(decodeGuardianLifecycle(await (await openSqliteLifecycleStore(target)).read()),initial);}
  finally{await killWriter(child);}
  assert.deepEqual(decodeGuardianLifecycle(await store.read()),initial);
 });
});

test('backup racing a committed write captures one complete revision without reverting the source',async()=>{
 await fixture(async({target,store,initial})=>{
  const event=cmd(initial,'record_usage',{seconds:600});const [,metadata]=await Promise.all([commitGuardianCommand(store,event),store.backup(target)]);
  const copy=decodeGuardianLifecycle(await (await openSqliteLifecycleStore(target)).read()),current=decodeGuardianLifecycle(await store.read());
  assert.equal(current.revision,1);assert.equal(getGuardianSession(current).dailySeconds,600);
  assert.equal(metadata.revision,copy.revision);assert.ok([0,1].includes(copy.revision));assert.equal(getGuardianSession(copy).dailySeconds,copy.revision===0?0:600);
 });
});

test('inspection is read-only and a stale backup cannot change the newer live ledger',async()=>{
 await fixture(async({source,target,store,initial})=>{
  const metadata=await store.backup(target),before=readFileSync(target),modified=statSync(target).mtimeMs;
  await commitGuardianCommand(store,cmd(initial,'record_usage',{seconds:300}));const live=await store.read();
  assert.deepEqual(await inspectSqliteLifecycleBackup(target),metadata);assert.deepEqual(readFileSync(target),before);assert.equal(statSync(target).mtimeMs,modified);
  assert.equal(await store.read(),live);assert.equal(decodeGuardianLifecycle(live).revision,1);assert.equal(metadata.revision,0);
  assert.ok(existsSync(source));
 });
});

test('backup never overwrites the source, an existing target or a symbolic alias',async()=>{
 await fixture(async({source,target,store,directory})=>{
  const before=await store.read();writeFileSync(target,'preserve-existing',{mode:0o600});
  await rejected(()=>store.backup(target),'ALREADY_EXISTS');assert.equal(readFileSync(target,'utf8'),'preserve-existing');
  await rejected(()=>store.backup(source),'ALREADY_EXISTS');assert.equal(await store.read(),before);
  const alias=join(directory,'alias.sqlite3');symlinkSync(source,alias);await rejected(()=>store.backup(alias),'ALREADY_EXISTS');assert.equal(await store.read(),before);
 });
});

test('unsafe targets and corrupted sources fail without generating a usable backup',async()=>{
 await fixture(async({source,target,store,directory})=>{
  const unsafe=join(directory,'unsafe');mkdirSync(unsafe,{mode:0o755});chmodSync(unsafe,0o755);const output=join(unsafe,'copy.sqlite3');
  await rejected(()=>store.backup(output),'UNSAFE_STORAGE');assert.equal(existsSync(output),false);
  changeDb(source,"UPDATE guardian_state SET payload='{}'");const bytes=readFileSync(source);
  await rejected(()=>store.backup(target),'CORRUPT_STORE');assert.equal(existsSync(target),false);assert.deepEqual(readFileSync(source),bytes);
 });
});

test('read-only inspection rejects missing, corrupt or unsupported backups without recreation',async()=>{
 await fixture(async({target,store,directory})=>{
  const missing=join(directory,'missing.sqlite3');await rejected(()=>inspectSqliteLifecycleBackup(missing),'STORE_MISSING');assert.equal(existsSync(missing),false);
  await store.backup(target);changeDb(target,'PRAGMA user_version=2');const before=readFileSync(target);
  await rejected(()=>inspectSqliteLifecycleBackup(target),'UNSUPPORTED_STORE');assert.deepEqual(readFileSync(target),before);
  const corrupt=join(directory,'corrupt.sqlite3');writeFileSync(corrupt,'not-sqlite',{mode:0o600});await rejected(()=>inspectSqliteLifecycleBackup(corrupt),'CORRUPT_STORE');assert.equal(readFileSync(corrupt,'utf8'),'not-sqlite');
 });
});


const cli=fileURLToPath(new URL('../apps/node-reference/backup.mjs',import.meta.url));
const runCli=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000});

test('backup and inspect CLIs emit metadata without private snapshots or source changes',async()=>{
 await fixture(async({source,target,store})=>{
  const before=await store.read(),created=runCli(['backup','--source',source,'--target',target]);
  assert.equal(created.status,0,created.stderr);const metadata=JSON.parse(created.stdout);assert.equal(metadata.snapshotSha256,sha(before));
  const checked=runCli(['inspect','--source',target]);assert.equal(checked.status,0,checked.stderr);assert.deepEqual(JSON.parse(checked.stdout),metadata);
  assert.equal(checked.stdout.includes('sourceSession'),false);assert.equal(checked.stdout.includes('correctOptionId'),false);assert.equal(await store.read(),before);
 });
});

test('CLI refuses missing, duplicate and unsupported flags before touching storage',()=>{
 for(const args of [[],['restore'],['backup','--source','x'],['inspect','--source','x','--target','y'],['backup','--source','x','--source','z','--target','y'],['inspect','--source','--target'],['inspect','--unknown','private-SENTINEL']]){
  const result=runCli(args);assert.equal(result.status,2);assert.equal(JSON.parse(result.stderr).code,'INVALID_ARGUMENTS');assert.equal(result.stdout,'');assert.equal(result.stderr.includes('private-SENTINEL'),false);
 }
});

test('CLI storage failures produce fixed errors and never overwrite an existing destination',async()=>{
 await fixture(async({source,target,store})=>{
  writeFileSync(target,'keep-existing',{mode:0o600});const before=await store.read(),result=runCli(['backup','--source',source,'--target',target]);
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).code,'ALREADY_EXISTS');assert.equal(result.stdout,'');assert.equal(readFileSync(target,'utf8'),'keep-existing');assert.equal(await store.read(),before);
 });
});
