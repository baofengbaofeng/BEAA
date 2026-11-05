import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeQuestionBankCatalog,encodeQuestionBankCatalog} from '../../shared/quiz/catalog.mjs';
import {invokePythonWorker} from './python-worker.mjs';
const WORKER=fileURLToPath(new URL('./question_bank_worker.py',import.meta.url));
const MESSAGES={ALREADY_EXISTS:'Question-bank database already exists',STORE_MISSING:'Question-bank database is missing',UNSAFE_STORAGE:'Private owned storage is required',UNSUPPORTED_STORE:'Unsupported question-bank database',UNSUPPORTED_PLATFORM:'Reference store requires POSIX and Python 3.11+',CORRUPT_STORE:'Question-bank database is inconsistent',STORE_BUSY:'Question-bank transaction is busy',STORE_IO:'Question-bank operation failed',INVALID_REQUEST:'Invalid question-bank storage request',INVALID_SNAPSHOT:'Invalid question-bank replacement',BACKEND_UNAVAILABLE:'Python SQLite backend unavailable',STORE_TIMEOUT:'Question-bank operation timed out',PROTOCOL_ERROR:'Invalid backend response'};
export class QuestionBankStoreError extends Error {
 constructor(code){super(MESSAGES[code]??MESSAGES.PROTOCOL_ERROR);this.name='QuestionBankStoreError';this.code=Object.hasOwn(MESSAGES,code)?code:'PROTOCOL_ERROR';}
}
const check=(ok,code)=>{if(!ok)throw new QuestionBankStoreError(code);};
function configuration(path,options){
 check(typeof path==='string'&&path.length>0&&!path.includes('\0')&&options&&typeof options==='object'&&!Array.isArray(options)&&Object.keys(options).every(k=>k==='python'),'INVALID_REQUEST');
 const python=options.python??'python3';check(typeof python==='string'&&python.trim().length>0&&!python.includes('\0'),'INVALID_REQUEST');return {path:resolve(path),python};
}
function snapshot(text,code){try{const value=decodeQuestionBankCatalog(text);check(Buffer.from(value.lifecycleId,'utf8').toString('utf8')===value.lifecycleId,code);return value;}catch{throw new QuestionBankStoreError(code);}}
async function request(config,message){try{return await invokePythonWorker(WORKER,config.path,config.python,message);}catch(error){throw new QuestionBankStoreError(error.code);}}
function port(config){return {
 async read(){const text=await request(config,{operation:'read'});snapshot(text,'CORRUPT_STORE');return text;},
 async compareAndSwap(expected,text){
  check(expected&&typeof expected==='object'&&!Array.isArray(expected)&&Reflect.ownKeys(expected).length===2&&Object.hasOwn(expected,'lifecycleId')&&Object.hasOwn(expected,'revision')&&typeof expected.lifecycleId==='string'&&Number.isSafeInteger(expected.revision)&&expected.revision>=0&&expected.revision<Number.MAX_SAFE_INTEGER,'INVALID_REQUEST');
  const next=snapshot(text,'INVALID_SNAPSHOT');check(next.lifecycleId===expected.lifecycleId&&next.revision===expected.revision+1,'INVALID_SNAPSHOT');
  const result=await request(config,{operation:'cas',expected:{lifecycleId:expected.lifecycleId,revision:expected.revision},text});check(typeof result==='boolean','PROTOCOL_ERROR');return result;
 }
};}
export async function createSqliteQuestionBankStore(path,initial,options={}){
 const config=configuration(path,options);let text;try{text=encodeQuestionBankCatalog(initial);}catch{throw new QuestionBankStoreError('INVALID_SNAPSHOT');}check(snapshot(text,'INVALID_SNAPSHOT').revision===0,'INVALID_SNAPSHOT');check(await request(config,{operation:'initialize',text})===true,'PROTOCOL_ERROR');return port(config);
}
export async function openSqliteQuestionBankStore(path,options={}){const store=port(configuration(path,options));await store.read();return store;}
