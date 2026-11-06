import {QuestionBankError,decodeQuestionBankCatalog,encodeQuestionBankCatalog,applyQuestionBankImport,summarizeQuestionBank} from '../quiz/catalog.mjs';
import {commitGuardianCommand} from './lifecycle-controller.mjs';
import {decodeGuardianLifecycle} from './guardian-lifecycle.mjs';
const check=(ok,code,message)=>{if(!ok)throw new QuestionBankError(code,message);};
function capture(input){try{return structuredClone(input);}catch{throw new QuestionBankError('INVALID_COMMAND','Question-bank command cannot be captured');}}
async function authorize(authorizer,token){
 let proof;try{proof=await authorizer.authorize(token);}catch{throw new QuestionBankError('PARENT_UNAUTHORIZED','Parent authorization required');}
 check(proof&&typeof proof==='object'&&!Array.isArray(proof)&&Reflect.ownKeys(proof).length===2&&Object.hasOwn(proof,'lifecycleId')&&Object.hasOwn(proof,'credentialVersion')&&typeof proof.lifecycleId==='string'&&proof.lifecycleId.length>0&&proof.lifecycleId.length<=96&&proof.lifecycleId.trim()===proof.lifecycleId&&Number.isSafeInteger(proof.credentialVersion)&&proof.credentialVersion>=1,'PARENT_UNAUTHORIZED','Invalid parent authorization proof');
 return {lifecycleId:proof.lifecycleId,credentialVersion:proof.credentialVersion};
}
async function readCatalog(store){let text;try{text=await store.read();}catch{throw new QuestionBankError('STORE_FAILURE','Unable to read the saved question bank');}return decodeQuestionBankCatalog(text);}
/** Trusted dependency boundary: no caller-supplied authorization boolean or proof. */
export async function commitParentQuestionBank(store,authorizer,token,command){
 check(store&&typeof store.read==='function'&&typeof store.compareAndSwap==='function','INVALID_STORE','An atomic question-bank store is required');
 check(authorizer&&typeof authorizer.authorize==='function','INVALID_AUTHORIZER','A trusted parent authorizer is required');
 const captured=capture(command);check(captured?.type==='replace_bank'&&typeof captured.lifecycleId==='string','INVALID_COMMAND','Only question-bank replacement is permitted');
 const before=await authorize(authorizer,token);check(before.lifecycleId===captured.lifecycleId,'PARENT_SCOPE_MISMATCH','Parent authorization belongs to another ledger');
 const current=await readCatalog(store);check(current.lifecycleId===before.lifecycleId,'PARENT_SCOPE_MISMATCH','Saved question bank belongs to another ledger');
 const next=applyQuestionBankImport(current,captured),text=next.duplicate?null:encodeQuestionBankCatalog(next.state);
 const after=await authorize(authorizer,token);check(after.lifecycleId===before.lifecycleId&&after.credentialVersion===before.credentialVersion,'PARENT_AUTH_CHANGED','Parent authorization changed before import');
 // Last authorization is the acceptance point; credentials and catalog are not one transaction.
 if(!next.duplicate){let committed;try{committed=await store.compareAndSwap({lifecycleId:current.lifecycleId,revision:current.revision},text);}catch{throw new QuestionBankError('STORE_FAILURE','Import acknowledgement unavailable; read and retry the same command');}check(typeof committed==='boolean','STORE_FAILURE','Invalid question-bank commit response');check(committed,'CONFLICT','Question bank changed before import');}
 return {outcome:next.duplicate?'duplicate':'committed',lifecycleId:next.state.lifecycleId,revision:next.state.revision,summary:summarizeQuestionBank(next.state.bank)};
}
/** Trusted quiz-start service. Existing pinned quizzes never read this mutable catalog. */
export async function beginQuizFromQuestionBank(guardianStore,bankStore,command){
 const captured=capture(command);check(captured?.type==='begin_quiz'&&typeof captured.lifecycleId==='string','INVALID_COMMAND','Only quiz-start commands are permitted');
 check(guardianStore&&typeof guardianStore.read==='function'&&typeof guardianStore.compareAndSwap==='function','INVALID_STORE','An atomic lifecycle store is required');
 let saved;try{saved=await guardianStore.read();}catch{throw new QuestionBankError('STORE_FAILURE','Unable to read the saved lifecycle');}
 let current;try{current=decodeGuardianLifecycle(saved);}catch{throw new QuestionBankError('INVALID_LIFECYCLE','Invalid saved lifecycle');}
 // Already committed starts recover from the pinned receipt, without consulting a later catalog.
 if(current.lastReceipt?.command.eventId===captured.eventId)return commitGuardianCommand(guardianStore,captured);
 check(bankStore&&typeof bankStore.read==='function','INVALID_STORE','A committed question-bank store is required');
 const catalog=await readCatalog(bankStore);check(catalog.lifecycleId===captured.lifecycleId,'SCOPE_MISMATCH','Question bank belongs to another ledger');
 return commitGuardianCommand(guardianStore,captured,{bank:catalog.bank});
}
