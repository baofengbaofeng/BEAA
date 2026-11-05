import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGuardianLifecycle,encodeGuardianLifecycle } from '../../shared/domain/guardian-lifecycle.mjs';

const WORKER=fileURLToPath(new URL('./sqlite_worker.py',import.meta.url));
const MAX_BYTES=32*1024*1024;
const MESSAGES={ALREADY_EXISTS:'Database already exists',STORE_MISSING:'Database is missing',UNSAFE_STORAGE:'Private owned storage is required',
  UNSUPPORTED_STORE:'Unsupported database format',UNSUPPORTED_PLATFORM:'Reference adapter requires POSIX and Python 3.11+',CORRUPT_STORE:'Stored data is inconsistent',
  STORE_BUSY:'Database transaction is busy',STORE_IO:'Database operation failed',INVALID_REQUEST:'Invalid storage request',
  INVALID_SNAPSHOT:'Invalid lifecycle replacement',BACKEND_UNAVAILABLE:'Python SQLite backend unavailable',STORE_TIMEOUT:'Database operation timed out',PROTOCOL_ERROR:'Invalid backend response'};
export class SqliteStoreError extends Error {
  constructor(code){super(MESSAGES[code]??MESSAGES.PROTOCOL_ERROR);this.name='SqliteStoreError';this.code=Object.hasOwn(MESSAGES,code)?code:'PROTOCOL_ERROR';}
}
function check(ok,code){if(!ok)throw new SqliteStoreError(code);}
function snapshot(text){
  try{const value=decodeGuardianLifecycle(text);check(Buffer.from(value.lifecycleId,'utf8').toString('utf8')===value.lifecycleId,'INVALID_SNAPSHOT');return value;}
  catch{throw new SqliteStoreError('INVALID_SNAPSHOT');}
}
function worker(path,python,message){
  const input=JSON.stringify(message);check(Buffer.byteLength(input,'utf8')<=MAX_BYTES,'INVALID_REQUEST');
  return new Promise((resolveResult,reject)=>{
    const child=spawn(python,[WORKER,path],{stdio:['pipe','pipe','pipe'],shell:false});let settled=false,bytes=0;const output=[];
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolveResult(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new SqliteStoreError('STORE_TIMEOUT'));},10000);
    child.once('error',()=>finish(new SqliteStoreError('BACKEND_UNAVAILABLE')));
    child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',part=>{bytes+=part.length;if(bytes>MAX_BYTES){child.kill('SIGKILL');finish(new SqliteStoreError('PROTOCOL_ERROR'));}else output.push(part);});
    child.once('close',code=>{
      if(settled)return;
      let response;try{response=JSON.parse(Buffer.concat(output).toString('utf8'));}catch{return finish(new SqliteStoreError('PROTOCOL_ERROR'));}
      if(!response || typeof response!=='object' || Array.isArray(response))return finish(new SqliteStoreError('PROTOCOL_ERROR'));
      if(response.ok===false && typeof response.code==='string')return finish(new SqliteStoreError(response.code));
      if(code!==0 || response.ok!==true || !Object.hasOwn(response,'value'))return finish(new SqliteStoreError('PROTOCOL_ERROR'));
      finish(null,response.value);
    });
    child.stdin.end(input);
  });
}
function options(path,input){
  check(typeof path==='string' && path.length>0 && !path.includes('\0') && input && typeof input==='object' && !Array.isArray(input) && Object.keys(input).every(k=>k==='python'),'INVALID_REQUEST');
  const python=input.python??'python3';check(typeof python==='string' && python.trim().length>0 && !python.includes('\0'),'INVALID_REQUEST');return {path:resolve(path),python};
}
function metadata(text){
  const state=snapshot(text);return {lifecycleId:state.lifecycleId,revision:state.revision,snapshotSha256:createHash('sha256').update(text,'utf8').digest('hex')};
}
function port(configuration){
  return {
    async read(){
      const text=await worker(configuration.path,configuration.python,{operation:'read'});snapshot(text);return text;
    },
    async backup(targetPath){
      const target=options(targetPath,{python:configuration.python});
      // Full business validation precedes destination creation. The helper pins its own
      // consistent source revision; a concurrent valid commit may produce a newer backup.
      snapshot(await worker(configuration.path,configuration.python,{operation:'read'}));
      return metadata(await worker(configuration.path,configuration.python,{operation:'backup',target:target.path}));
    },
    async compareAndSwap(expected,text){
      check(expected && typeof expected==='object' && !Array.isArray(expected) && Object.keys(expected).length===2 && Object.hasOwn(expected,'lifecycleId') && Object.hasOwn(expected,'revision') && typeof expected.lifecycleId==='string' && Number.isSafeInteger(expected.revision) && expected.revision>=0 && expected.revision<Number.MAX_SAFE_INTEGER,'INVALID_REQUEST');
      const next=snapshot(text);check(next.lifecycleId===expected.lifecycleId && next.revision===expected.revision+1,'INVALID_SNAPSHOT');
      const value=await worker(configuration.path,configuration.python,{operation:'cas',expected:{lifecycleId:expected.lifecycleId,revision:expected.revision},text});
      check(typeof value==='boolean','PROTOCOL_ERROR');return value;
    }
  };
}
export async function createSqliteLifecycleStore(path,initial,configuration={}){
  const settings=options(path,configuration);let text;
  try{text=encodeGuardianLifecycle(initial);}catch{throw new SqliteStoreError('INVALID_SNAPSHOT');}
  const state=snapshot(text);check(state.revision===0,'INVALID_SNAPSHOT');
  check(await worker(settings.path,settings.python,{operation:'initialize',text})===true,'PROTOCOL_ERROR');return port(settings);
}
export async function openSqliteLifecycleStore(path,configuration={}){
  const store=port(options(path,configuration));await store.read();return store;
}

/** Read-only validation of a backup, with no automatic ledger restoration or private payload output. */
export async function inspectSqliteLifecycleBackup(path,configuration={}){
  const settings=options(path,configuration);
  return metadata(await worker(settings.path,settings.python,{operation:'inspect'}));
}
