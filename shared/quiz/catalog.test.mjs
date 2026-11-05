import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuestionBankCatalog,validateQuestionBankCatalog,encodeQuestionBankCatalog,decodeQuestionBankCatalog,applyQuestionBankImport,summarizeQuestionBank} from './catalog.mjs';
import {bank} from '../../tests/helpers/guardian-fixture.mjs';
const fresh=()=>createQuestionBankCatalog('family-1',bank);
const command=(state,changes={})=>({lifecycleId:state.lifecycleId,eventId:'import-'+state.revision,expectedRevision:state.revision,type:'replace_bank',payload:{bank:structuredClone(bank)},...changes});

test('question bank catalogs normalize, encode and decode independently of source inputs',()=>{
 const input=structuredClone(bank),state=createQuestionBankCatalog('family-1',input);input.questions[0].stem='changed';assert.equal(state.revision,0);assert.equal(state.lastImport,null);assert.deepEqual(decodeQuestionBankCatalog(encodeQuestionBankCatalog(state)),state);
 const clone=validateQuestionBankCatalog(state);clone.bank.questions[0].stem='another';assert.notEqual(clone.bank.questions[0].stem,state.bank.questions[0].stem);
});
test('imports advance one version and latest exact retries are idempotent',()=>{
 const initial=fresh(),event=command(initial),next=applyQuestionBankImport(initial,event);assert.equal(next.duplicate,false);assert.equal(next.state.revision,1);assert.equal(initial.revision,0);assert.equal(next.state.lastImport.eventId,event.eventId);
 assert.equal(applyQuestionBankImport(next.state,event).duplicate,true);
 const reordered=JSON.parse(JSON.stringify(event));reordered.payload.bank.questions[0]=Object.fromEntries(Object.entries(reordered.payload.bank.questions[0]).reverse());assert.equal(applyQuestionBankImport(next.state,reordered).duplicate,true);
});
test('event reuse, stale revision and another family never replace the catalog',()=>{
 const initial=fresh(),event=command(initial),next=applyQuestionBankImport(initial,event).state;
 const changed=structuredClone(event);changed.payload.bank.questions[0].stem='different';assert.throws(()=>applyQuestionBankImport(next,changed),e=>e.code==='EVENT_REUSE');
 assert.throws(()=>applyQuestionBankImport(next,{...event,eventId:'another'}),e=>e.code==='CONFLICT');assert.throws(()=>applyQuestionBankImport(initial,{...event,lifecycleId:'other'}),e=>e.code==='SCOPE_MISMATCH');
});
test('bad envelopes, receipts, bank data and versions are rejected without normalization to empty',()=>{
 for(const input of [null,{},[],{...fresh(),schemaVersion:2},{...fresh(),extra:true},{...fresh(),revision:-1},{...fresh(),revision:1.1},{...fresh(),lastImport:{eventId:'x',expectedRevision:0}},{...fresh(),revision:2,lastImport:{eventId:'x',expectedRevision:0}},{...fresh(),bank:{version:1,questions:[]}}])assert.throws(()=>validateQuestionBankCatalog(input));
 for(const text of ['', '{}','null','{broken'])assert.throws(()=>decodeQuestionBankCatalog(text));
});
test('invalid import identities and command shapes are refused',()=>{
 const state=fresh();for(const changes of [{eventId:''},{expectedRevision:-1},{type:'record_usage'},{extra:true},{payload:{bank,extra:true}},{payload:{bank:{version:1,questions:[]}}}])assert.throws(()=>applyQuestionBankImport(state,command(state,changes)));
 assert.throws(()=>createQuestionBankCatalog('',bank));
});
test('encoded catalog size is bounded before persistence and parsing',()=>{
 const state=fresh();state.bank.questions=Array.from({length:400},(_,i)=>({...structuredClone(bank.questions[0]),id:'q-'+i,stem:'题'.repeat(2000),explanation:'解'.repeat(4000)}));
 assert.throws(()=>encodeQuestionBankCatalog(state),e=>e.code==='CATALOG_TOO_LARGE');assert.throws(()=>decodeQuestionBankCatalog(' '.repeat(2000001)),e=>e.code==='CATALOG_TOO_LARGE');
});
test('revision exhaustion cannot wrap or mint a new initial catalog',()=>{
 const state={...fresh(),revision:Number.MAX_SAFE_INTEGER,lastImport:{eventId:'last',expectedRevision:Number.MAX_SAFE_INTEGER-1}};assert.throws(()=>applyQuestionBankImport(state,command(state)),e=>e.code==='COUNTER_EXHAUSTED');
});
test('coverage summaries show all grades and subjects without exposing answers',()=>{
 const report=summarizeQuestionBank(bank);assert.equal(report.questionCount,5);assert.equal(report.grades.length,6);assert.deepEqual(report.grades[2],{grade:3,subjects:{chinese:1,math:3,english:1}});assert.deepEqual(report.grades[0],{grade:1,subjects:{chinese:0,math:0,english:0}});assert(!JSON.stringify(report).includes('correctOptionId'));
});
