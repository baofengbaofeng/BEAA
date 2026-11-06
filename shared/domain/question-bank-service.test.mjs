import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuestionBankCatalog,encodeQuestionBankCatalog,decodeQuestionBankCatalog} from '../quiz/catalog.mjs';
import {commitParentQuestionBank,beginQuizFromQuestionBank} from './question-bank-service.mjs';
import {commitGuardianCommand} from './lifecycle-controller.mjs';
import {encodeGuardianLifecycle,decodeGuardianLifecycle,getGuardianView,getGuardianSession} from './guardian-lifecycle.mjs';
import {freshGuardian,bank,cmd,step,answerCmd,finishGuardian} from '../../tests/helpers/guardian-fixture.mjs';
function memory(text){return {text,reads:0,writes:0,async read(){this.reads++;return this.text;},async compareAndSwap(expected,next){const current=JSON.parse(this.text);if(current.lifecycleId!==expected.lifecycleId||current.revision!==expected.revision)return false;this.writes++;this.text=next;return true;}};}
const catalog=()=>createQuestionBankCatalog('family-ledger-1',bank);
const event=(state,content=bank)=>({lifecycleId:state.lifecycleId,eventId:'bank-'+state.revision,expectedRevision:state.revision,type:'replace_bank',payload:{bank:structuredClone(content)}});
const authorizer=(version=1)=>({authorize:async()=>({lifecycleId:'family-ledger-1',credentialVersion:version})});

test('parent authorization is required before reading the saved answer bank',async()=>{
 const store=memory(encodeQuestionBankCatalog(catalog()));await assert.rejects(commitParentQuestionBank(store,{authorize(){throw Error('private-token');}},null,event(catalog())),e=>e.code==='PARENT_UNAUTHORIZED'&&!e.message.includes('private-token'));assert.equal(store.reads,0);assert.equal(store.writes,0);
});
test('authorized import returns only revision and coverage, not answers or credentials',async()=>{
 const store=memory(encodeQuestionBankCatalog(catalog())),command=event(catalog());const result=await commitParentQuestionBank(store,authorizer(),'secret-token',command);assert.equal(result.revision,1);assert.equal(result.outcome,'committed');assert.equal(result.summary.questionCount,5);assert(!JSON.stringify(result).includes('correctOptionId'));assert(!JSON.stringify(result).includes('secret-token'));
 assert.equal((await commitParentQuestionBank(store,authorizer(),'secret-token',command)).outcome,'duplicate');assert.equal(store.writes,1);
});
test('another family cannot read or write the saved bank',async()=>{
 const store=memory(encodeQuestionBankCatalog(createQuestionBankCatalog('other',bank)));
 await assert.rejects(commitParentQuestionBank(store,authorizer(),null,event(catalog())),e=>e.code==='PARENT_SCOPE_MISMATCH');assert.equal(store.writes,0);
 const before=store.reads;await assert.rejects(commitParentQuestionBank(store,authorizer(),null,event(createQuestionBankCatalog('other',bank))),e=>e.code==='PARENT_SCOPE_MISMATCH');assert.equal(store.reads,before);
});
test('authorization changes during read prevent CAS',async()=>{
 let version=1;const store=memory(encodeQuestionBankCatalog(catalog())),read=store.read.bind(store);store.read=async()=>{version=2;return read();};await assert.rejects(commitParentQuestionBank(store,{authorize:async()=>({lifecycleId:'family-ledger-1',credentialVersion:version})},null,event(catalog())),e=>e.code==='PARENT_AUTH_CHANGED');assert.equal(store.writes,0);
});
test('the command bank is captured before asynchronous authorization',async()=>{
 const store=memory(encodeQuestionBankCatalog(catalog())),command=event(catalog());let release,n=0;
 const auth={authorize:async()=>{if(n++===0)await new Promise(resolve=>{release=resolve;});return {lifecycleId:'family-ledger-1',credentialVersion:1};}};
 const pending=commitParentQuestionBank(store,auth,null,command);command.payload.bank.questions[0].stem='mutated-by-caller';release();await pending;assert.equal(decodeQuestionBankCatalog(store.text).bank.questions[0].stem,bank.questions[0].stem);
});
test('conflicts, malformed commits and unavailable stores fail without a fabricated receipt',async()=>{
 for(const response of [false,'true']){const store=memory(encodeQuestionBankCatalog(catalog()));store.compareAndSwap=async()=>response;await assert.rejects(commitParentQuestionBank(store,authorizer(),null,event(catalog())),e=>e.code===(response===false?'CONFLICT':'STORE_FAILURE'));assert.equal(JSON.parse(store.text).revision,0);}
 const store=memory('{broken');await assert.rejects(commitParentQuestionBank(store,authorizer(),null,event(catalog())),e=>e.code==='INVALID_CATALOG');assert.equal(store.text,'{broken');
 const unavailable={read:async()=>{throw Error('private-store');},compareAndSwap(){throw Error('should not write');}};await assert.rejects(commitParentQuestionBank(unavailable,authorizer(),null,event(catalog())),e=>e.code==='STORE_FAILURE'&&!e.message.includes('private-store'));
});
test('a lost committed import acknowledgement retries as one version',async()=>{
 const store=memory(encodeQuestionBankCatalog(catalog())),cas=store.compareAndSwap.bind(store),command=event(catalog());store.compareAndSwap=async(...args)=>{await cas(...args);throw Error('lost ack');};await assert.rejects(commitParentQuestionBank(store,authorizer(),null,command),e=>e.code==='STORE_FAILURE');store.compareAndSwap=cas;assert.equal((await commitParentQuestionBank(store,authorizer(),null,command)).outcome,'duplicate');assert.equal(JSON.parse(store.text).revision,1);
});
test('import during a quiz keeps pinned grading and the next round reads the new catalog',async()=>{
 const ledger=memory(encodeGuardianLifecycle(step(freshGuardian(),'record_usage',{seconds:1800}))),store=memory(encodeQuestionBankCatalog(catalog()));
 await beginQuizFromQuestionBank(ledger,store,cmd(decodeGuardianLifecycle(ledger.text),'begin_quiz',{knowledgePoints:[]}));const pinned=ledger.text;
 const changed=structuredClone(bank);for(const q of changed.questions){q.stem='新版 '+q.stem;q.correctOptionId=q.options.find(o=>o.id!==q.correctOptionId).id;}
 await commitParentQuestionBank(store,authorizer(),null,event(catalog(),changed));assert.equal(ledger.text,pinned);
 while(getGuardianView(decodeGuardianLifecycle(ledger.text)).question)await commitGuardianCommand(ledger,answerCmd(decodeGuardianLifecycle(ledger.text)));
 let state=decodeGuardianLifecycle(ledger.text);assert.equal(getGuardianSession(state).phase,'REST_REQUIRED');assert.equal(state.history.records.length,1);
 state=finishGuardian(state);ledger.text=encodeGuardianLifecycle(step(state,'record_usage',{seconds:1800}));
 const result=await beginQuizFromQuestionBank(ledger,store,cmd(decodeGuardianLifecycle(ledger.text),'begin_quiz',{knowledgePoints:[]}));assert.equal(decodeQuestionBankCatalog(store.text).revision,1);assert(result.question.stem.startsWith('新版 '));
});
test('an unusable or foreign catalog never writes or clears a challenge ledger',async()=>{
 const state=step(freshGuardian(),'record_usage',{seconds:1800}),text=encodeGuardianLifecycle(state),command=cmd(state,'begin_quiz',{knowledgePoints:[]});
 const unavailable=structuredClone(bank);for(const q of unavailable.questions)q.grade=1;
 for(const [source,code] of [[encodeQuestionBankCatalog(createQuestionBankCatalog('other',bank)),'SCOPE_MISMATCH'],[encodeQuestionBankCatalog(createQuestionBankCatalog(state.lifecycleId,unavailable)),'INSUFFICIENT_QUESTIONS'],['{broken','INVALID_CATALOG']]){const ledger=memory(text);await assert.rejects(beginQuizFromQuestionBank(ledger,memory(source),command),e=>e.code===code);assert.equal(ledger.text,text);assert.equal(ledger.writes,0);}
});
test('the quiz bank entry point refuses non-quiz commands before reading answers',async()=>{
 const store=memory(encodeQuestionBankCatalog(catalog())),state=freshGuardian();await assert.rejects(beginQuizFromQuestionBank(memory(encodeGuardianLifecycle(state)),store,cmd(state,'record_usage',{seconds:30})),e=>e.code==='INVALID_COMMAND');assert.equal(store.reads,0);
});
test('a quiz-start retry after lost acknowledgement uses its pinned receipt even if the catalog is unavailable',async()=>{
 const state=step(freshGuardian(),'record_usage',{seconds:1800}),ledger=memory(encodeGuardianLifecycle(state)),store=memory(encodeQuestionBankCatalog(catalog())),command=cmd(state,'begin_quiz',{knowledgePoints:[]});
 const cas=ledger.compareAndSwap.bind(ledger);ledger.compareAndSwap=async(...args)=>{await cas(...args);throw Error('lost start acknowledgement');};
 await assert.rejects(beginQuizFromQuestionBank(ledger,store,command),e=>e.code==='STORE_FAILURE');ledger.compareAndSwap=cas;
 store.read=async()=>{throw Error('catalog unavailable after committed start');};
 const result=await beginQuizFromQuestionBank(ledger,store,command);assert.equal(result.outcome,'duplicate');assert.equal(result.revision,state.revision+1);assert.equal(ledger.writes,1);assert(!Object.hasOwn(result,'bankRevision'));
});
