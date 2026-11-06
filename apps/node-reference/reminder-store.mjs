import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadNativeCore} from '../../scripts/native-core.mjs';
import {invokePythonWorker} from './python-worker.mjs';
const {validateReminderQueue,createReminderQueue}=loadNativeCore(['ReminderDelivery']);
const WORKER=fileURLToPath(new URL('./reminder_worker.py',import.meta.url));
const CODES=['INVALID_REQUEST','ALREADY_EXISTS','STORE_MISSING','UNSAFE_STORAGE','UNSUPPORTED_STORE','CORRUPT_STORE','STORE_BUSY','STORE_IO','UNSUPPORTED_PLATFORM','BACKEND_UNAVAILABLE','STORE_TIMEOUT','PROTOCOL_ERROR'];
export class ReminderStoreError extends Error {constructor(code){super('Reminder storage rejected: '+(CODES.includes(code)?code:'PROTOCOL_ERROR'));this.name='ReminderStoreError';this.code=CODES.includes(code)?code:'PROTOCOL_ERROR';}}
function check(ok,code){if(!ok)throw new ReminderStoreError(code);}
function settings(path,options){check(typeof path==='string'&&path.length>0&&!path.includes('\0')&&options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='python'),'INVALID_REQUEST');const python=options.python??'python3';check(typeof python==='string'&&python.trim().length>0&&!python.includes('\0'),'INVALID_REQUEST');return {path:resolve(path),python};}
function snapshot(text){try{return validateReminderQueue(text);}catch{throw new ReminderStoreError('CORRUPT_STORE');}}
async function invoke(config,message){try{return await invokePythonWorker(WORKER,config.path,config.python,message);}catch(error){throw new ReminderStoreError(error.code);}}
function port(config){return {
 async read(){const text=await invoke(config,{operation:'read'});snapshot(text);return text;},
 async compareAndSwap(scopeId,revision,text){check(typeof scopeId==='string'&&Number.isSafeInteger(revision)&&revision>=0&&revision<Number.MAX_SAFE_INTEGER,'INVALID_REQUEST');const next=snapshot(text);check(next.scopeId===scopeId&&next.revision===revision+1,'INVALID_REQUEST');const result=await invoke(config,{operation:'cas',expected:{scopeId,revision},text});check(typeof result==='boolean','PROTOCOL_ERROR');return result;}
};}
export async function createSqliteReminderStore(path,scopeId,options={}){const config=settings(path,options);let text;try{text=createReminderQueue(scopeId);}catch{throw new ReminderStoreError('INVALID_REQUEST');}check(await invoke(config,{operation:'initialize',text})===true,'PROTOCOL_ERROR');return port(config);}
export async function openSqliteReminderStore(path,options={}){const store=port(settings(path,options));await store.read();return store;}
