import {validateQuestionBank} from './bank.mjs';

const MAX_TEXT=2_000_000;
export class QuestionBankError extends Error {
  constructor(code,message){super(message);this.name='QuestionBankError';this.code=code;}
}
const check=(ok,code,message)=>{if(!ok)throw new QuestionBankError(code,message);};
const id=(value,max=128)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value;
const revision=value=>Number.isSafeInteger(value)&&value>=0;
function fields(value,keys,code='INVALID_CATALOG'){
 check(value&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),code,'Invalid question-bank data fields');
}
function bankValue(input){try{return validateQuestionBank(input);}catch{throw new QuestionBankError('INVALID_BANK','Invalid question bank');}}
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
const canonical=value=>JSON.stringify(sorted(value));
function bounded(value){check(canonical(value).length<=MAX_TEXT,'CATALOG_TOO_LARGE','Question-bank catalog exceeds its size limit');return value;}
export function validateQuestionBankCatalog(input){
 fields(input,['schemaVersion','lifecycleId','revision','bank','lastImport']);
 check(input.schemaVersion===1&&id(input.lifecycleId,96)&&revision(input.revision),'INVALID_CATALOG','Invalid catalog identity or version');
 let lastImport=null;
 if(input.revision===0)check(input.lastImport===null,'INVALID_CATALOG','Initial catalog cannot contain an import receipt');
 else{fields(input.lastImport,['eventId','expectedRevision']);check(id(input.lastImport.eventId)&&revision(input.lastImport.expectedRevision)&&input.lastImport.expectedRevision===input.revision-1,'INVALID_CATALOG','Invalid import receipt');lastImport={eventId:input.lastImport.eventId,expectedRevision:input.lastImport.expectedRevision};}
 return bounded({schemaVersion:1,lifecycleId:input.lifecycleId,revision:input.revision,bank:bankValue(input.bank),lastImport});
}
export function createQuestionBankCatalog(lifecycleId,bank){return validateQuestionBankCatalog({schemaVersion:1,lifecycleId,revision:0,bank,lastImport:null});}
export function encodeQuestionBankCatalog(input){return canonical(validateQuestionBankCatalog(input));}
export function decodeQuestionBankCatalog(text){
 check(typeof text==='string','INVALID_CATALOG','Catalog JSON is required');check(text.length<=MAX_TEXT,'CATALOG_TOO_LARGE','Question-bank catalog exceeds its size limit');
 let value;try{value=JSON.parse(text);}catch{throw new QuestionBankError('INVALID_CATALOG','Invalid catalog JSON');}return validateQuestionBankCatalog(value);
}
export function applyQuestionBankImport(input,command){
 const current=validateQuestionBankCatalog(input);fields(command,['lifecycleId','eventId','expectedRevision','type','payload'],'INVALID_COMMAND');
 check(id(command.lifecycleId,96)&&id(command.eventId)&&revision(command.expectedRevision)&&command.type==='replace_bank','INVALID_COMMAND','Invalid import command');fields(command.payload,['bank'],'INVALID_COMMAND');
 const bank=bankValue(command.payload.bank);check(command.lifecycleId===current.lifecycleId,'SCOPE_MISMATCH','Question bank belongs to another ledger');
 if(current.lastImport?.eventId===command.eventId){check(current.lastImport.expectedRevision===command.expectedRevision&&canonical(current.bank)===canonical(bank),'EVENT_REUSE','Import event ID was reused for another command');return {state:current,duplicate:true};}
 check(command.expectedRevision===current.revision,'CONFLICT','Question bank changed before import');check(current.revision<Number.MAX_SAFE_INTEGER,'COUNTER_EXHAUSTED','Question-bank revision exhausted');
 return {state:validateQuestionBankCatalog({...current,revision:current.revision+1,bank,lastImport:{eventId:command.eventId,expectedRevision:command.expectedRevision}}),duplicate:false};
}
export function summarizeQuestionBank(input){
 const bank=bankValue(input),grades=Array.from({length:6},(_,i)=>({grade:i+1,subjects:{chinese:0,math:0,english:0}}));for(const q of bank.questions)grades[q.grade-1].subjects[q.subject]++;
 return {questionCount:bank.questions.length,grades};
}
