import test from 'node:test';
import assert from 'node:assert/strict';
import { ParentReportError,getParentLearningReport } from './parent-report.mjs';
import { encodeGuardianLifecycle } from './guardian-lifecycle.mjs';
import { freshGuardian,beginGuardian,answerGuardian,step,bank } from '../../tests/helpers/guardian-fixture.mjs';
function source(){
 const completed=answerGuardian(beginGuardian(freshGuardian()),true),next=structuredClone(bank);
 next.questions.forEach(q=>{q.id='future-'+q.id;q.stem='SECRET_UNANSWERED';});
 return step(completed,'begin_quiz',{knowledgePoints:[]},{bank:next});
}
const grant=()=>({lifecycleId:'family-ledger-1',credentialVersion:1});
const rejected=(fn,code)=>assert.rejects(fn,e=>e instanceof ParentReportError && (!code || e.code===code));

test('unauthorized or invalid authorizers cannot read a learning report',async()=>{
 let reads=0;const store={async read(){reads++;return encodeGuardianLifecycle(source());}};
 await rejected(()=>getParentLearningReport(store,{async authorize(){throw new Error('private-secret');}},'opaque'),'PARENT_UNAUTHORIZED');
 await rejected(()=>getParentLearningReport(store,{async authorize(){return true;}},'opaque'),'PARENT_UNAUTHORIZED');
 await rejected(()=>getParentLearningReport(store,{},'opaque'),'INVALID_AUTHORIZER');assert.equal(reads,0);
});

test('report scope must match the lifecycle even with a valid other-family grant',async()=>{
 const state=source(),before=structuredClone(state);
 await rejected(()=>getParentLearningReport({read:async()=>encodeGuardianLifecycle(state)},{authorize:async()=>({lifecycleId:'other-family',credentialVersion:1})},'opaque'),'PARENT_SCOPE_MISMATCH');
 assert.deepEqual(state,before);
});

test('authorized reports contain completed history only and check authorization twice',async()=>{
 const state=source();let checks=0;
 const report=await getParentLearningReport({read:async()=>encodeGuardianLifecycle(state)},{async authorize(){checks++;return grant();}},'opaque');
 assert.equal(checks,2);assert.equal(report.stats.quizCount,1);assert.equal(report.records.length,1);assert.equal(report.wrongAnswers.length,5);
 assert.equal(JSON.stringify(report).includes('SECRET_UNANSWERED'),false);assert.equal(JSON.stringify(report).includes('future-'),false);assert.equal(Object.hasOwn(report,'token'),false);
 report.wrongAnswers[0].question.stem='changed';assert.notEqual(state.history.records[0].questions[0].stem,'changed');
});

test('expiry, logout or credential change during the read prevents report release',async()=>{
 for(const changed of ['throw','version']){
  let checks=0;const auth={async authorize(){checks++;if(checks===2){if(changed==='throw')throw new Error('expired');return {...grant(),credentialVersion:2};}return grant();}};
  await rejected(()=>getParentLearningReport({read:async()=>encodeGuardianLifecycle(source())},auth,'opaque'),changed==='throw'?'PARENT_UNAUTHORIZED':'PARENT_AUTH_CHANGED');
 }
});

test('query input is captured before async authorization and keeps date/grade filtering',async()=>{
 const query={grade:3};let release,checks=0;
 const auth={authorize(){checks++;return checks===1?new Promise(resolve=>{release=()=>resolve(grant());}):Promise.resolve(grant());}};
 const pending=getParentLearningReport({read:async()=>encodeGuardianLifecycle(source())},auth,'opaque',query);query.grade=6;release();
 assert.equal((await pending).stats.quizCount,1);
 const empty=await getParentLearningReport({read:async()=>encodeGuardianLifecycle(source())},{authorize:async()=>grant()},'opaque',{grade:6});assert.equal(empty.stats.quizCount,0);
});

test('source failures and invalid queries cannot silently replace or clear the ledger',async()=>{
 const auth={authorize:async()=>grant()};
 await rejected(()=>getParentLearningReport({read:async()=>{throw new Error('private-path');}},auth,'opaque'),'STORE_FAILURE');
 await rejected(()=>getParentLearningReport({read:async()=>'{broken'},auth,'opaque'),'INVALID_REPORT_SOURCE');
 await rejected(()=>getParentLearningReport({read:async()=>encodeGuardianLifecycle(source())},auth,'opaque',{grade:7}),'INVALID_QUERY');
});
