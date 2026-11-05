import test from 'node:test';
import assert from 'node:assert/strict';
import { Phase } from './engine.mjs';
import { GuardianError,applyGuardianCommand,getGuardianSession,getGuardianView,getGuardianPolicyStatus,decodeGuardianLifecycle,encodeGuardianLifecycle } from './guardian-lifecycle.mjs';
import { getLearningStats } from './learning-history.mjs';
import { freshGuardian,cmd,step,beginGuardian,answerCmd,answerGuardian,observeGuardian,completeCmd,finishGuardian,bank } from '../../tests/helpers/guardian-fixture.mjs';
const set=(s,changes)=>step(s,'set_policy',{policy:{...s.policy,...changes}});
const rejects=(fn,code)=>assert.throws(fn,e=>e instanceof GuardianError && (!code || e.code===code));
const legacy=s=>{const {policy,dailyUsageSeconds,pendingPolicy,...old}=structuredClone(s);return {...old,schemaVersion:1};};

test('a lower then higher cap preserves actual usage rather than restoring spent allowance',()=>{
 let s=step(freshGuardian(),'record_usage',{seconds:1200});s=set(s,{dailyLimitMinutes:15});
 assert.equal(getGuardianView(s).dailySeconds,1200);assert.equal(s.dailyUsageSeconds,1200);assert.equal(getGuardianSession(s).dailySeconds,900);assert.equal(getGuardianSession(s).phase,Phase.DAILY_LOCKED);
 for(let i=0;i<3;i++){s=set(s,{dailyLimitMinutes:45});assert.equal(getGuardianSession(s).phase,Phase.AVAILABLE);assert.equal(getGuardianView(s).dailySeconds,1200);s=set(s,{dailyLimitMinutes:15});}
 s=set(s,{dailyLimitMinutes:45});s=step(s,'record_usage',{seconds:600});assert.equal(getGuardianView(s).dailySeconds,1800);assert.equal(getGuardianSession(s).phase,Phase.CHALLENGE_REQUIRED);
 assert.equal(getGuardianPolicyStatus(s).effect,'active');
});

test('ordinary-stage period edits recompute the guard without clearing cycle or daily counters',()=>{
 let s=step(freshGuardian(),'record_usage',{seconds:1200});s=set(s,{periodMinutes:15});assert.equal(getGuardianSession(s).phase,Phase.CHALLENGE_REQUIRED);
 s=set(s,{periodMinutes:45});assert.equal(getGuardianSession(s).phase,Phase.AVAILABLE);assert.equal(getGuardianSession(s).cycleSeconds,1200);assert.equal(s.dailyUsageSeconds,1200);
 const before=structuredClone(s);const out=applyGuardianCommand(s,cmd(s,'set_policy',{policy:{...s.policy,subjects:['math']}}));assert.deepEqual(s,before);out.state.policy.subjects.push('english');assert.deepEqual(s.policy.subjects,['chinese','math','english']);
});

test('active quiz edits defer, replace and cancel without altering pinned questions',()=>{
 let s=beginGuardian(freshGuardian()),original=structuredClone(s.stage.progress.attempt);
 s=set(s,{subjects:['math'],questionCount:3,requiredCorrect:2});assert.equal(getGuardianPolicyStatus(s).effect,'after_current_challenge');assert.equal(getGuardianView(s).policyPending,true);
 assert.deepEqual(s.stage.progress.attempt,original);assert.equal(s.policy.questionCount,5);
 s=set(s,{grade:4});assert.equal(s.pendingPolicy.grade,4);assert.equal(s.pendingPolicy.questionCount,5);
 s=set(s,{});assert.equal(s.pendingPolicy,null);assert.deepEqual(s.stage.progress.attempt,original);
});

test('pending threshold edits never retroactively turn an old failed quiz into a pass',()=>{
 let s=set(beginGuardian(freshGuardian()),{requiredCorrect:4});s=applyGuardianCommand(s,answerCmd(s,true)).state;s=answerGuardian(s);
 assert.equal(getLearningStats(s.history).passedQuizCount,0);assert.equal(getGuardianSession(s).phase,Phase.CHALLENGE_REQUIRED);assert.equal(s.policy.requiredCorrect,4);assert.equal(s.pendingPolicy,null);
 assert.equal(s.stage.progress.attempt.session.policy.requiredCorrect,5);s=step(s,'begin_quiz',{knowledgePoints:[]});
 s=applyGuardianCommand(s,answerCmd(s,true)).state;s=answerGuardian(s);assert.equal(getGuardianSession(s).phase,Phase.REST_REQUIRED);assert.equal(getLearningStats(s.history).passedQuizCount,1);
});

test('passing quiz and rest retain the old requirement until the original rest is complete',()=>{
 let s=set(beginGuardian(freshGuardian()),{restMinutes:5,dailyLimitMinutes:15});s=answerGuardian(s);
 assert.equal(s.policy.restMinutes,10);assert.equal(getGuardianPolicyStatus(s).effect,'after_current_rest');assert.equal(s.stage.progress.sourceSession.policy.restMinutes,10);
 s=observeGuardian(s,300000);rejects(()=>applyGuardianCommand(s,completeCmd(s)),'REST_NOT_COMPLETE');s=observeGuardian(s,300000);s=applyGuardianCommand(s,completeCmd(s)).state;
 assert.equal(s.policy.restMinutes,5);assert.equal(s.policy.dailyLimitMinutes,15);assert.equal(s.pendingPolicy,null);assert.equal(s.dailyUsageSeconds,1800);assert.equal(getGuardianView(s).dailySeconds,1800);assert.equal(getGuardianSession(s).phase,Phase.DAILY_LOCKED);
 assert.equal(s.history.records[0].requiredCorrect,5);assert.deepEqual(decodeGuardianLifecycle(encodeGuardianLifecycle(s)),s);
});

test('rest-stage learning changes apply before the next quiz and preserve the old record',()=>{
 let s=answerGuardian(beginGuardian(freshGuardian()));s=set(s,{subjects:['math'],questionCount:3,requiredCorrect:2});assert.equal(s.policy.questionCount,5);
 s=finishGuardian(s);assert.equal(s.policy.questionCount,3);assert.equal(s.history.records[0].questions.length,5);
 s=beginGuardian(s);assert.equal(s.stage.progress.attempt.questions.length,3);assert.ok(s.stage.progress.attempt.questions.every(q=>q.subject==='math'));assert.equal(s.dailyUsageSeconds,3600);
});

test('a failed quiz can receive new settings immediately without changing its stored score',()=>{
 let s=answerGuardian(beginGuardian(freshGuardian()),true);s=set(s,{grade:4,questionCount:3,requiredCorrect:2});
 assert.equal(getGuardianPolicyStatus(s).effect,'active');assert.equal(s.policy.grade,4);assert.equal(getLearningStats(s.history).correctCount,0);
 const changed=structuredClone(bank);changed.questions.forEach(q=>q.grade=4);s=step(s,'begin_quiz',{knowledgePoints:[]},{bank:changed});
 assert.equal(s.stage.progress.attempt.questions.length,3);assert.equal(s.stage.progress.attempt.questions[0].grade,4);assert.equal(s.dailyUsageSeconds,1800);
});

test('trusted day rollover clears only daily actual usage and retains pending rest settings',()=>{
 let s=set(answerGuardian(beginGuardian(freshGuardian())),{dailyLimitMinutes:15});s=step(s,'roll_day',{nextDay:'2026-11-06'});
 assert.equal(s.dailyUsageSeconds,0);assert.equal(getGuardianSession(s).phase,Phase.REST_REQUIRED);assert.ok(s.pendingPolicy);
 s=finishGuardian(s);assert.equal(s.policy.dailyLimitMinutes,15);assert.equal(getGuardianSession(s).phase,Phase.AVAILABLE);assert.equal(s.history.records[0].dayKey,'2026-11-05');
 s=step(s,'record_usage',{seconds:900});assert.equal(getGuardianSession(s).phase,Phase.DAILY_LOCKED);assert.equal(s.dailyUsageSeconds,900);
});

test('schema1 snapshots migrate strictly in memory with identity, progress and receipt intact',()=>{
 const initial=freshGuardian(),active=beginGuardian(initial),failed=answerGuardian(active,true),rest=observeGuardian(answerGuardian(active),300000),finished=finishGuardian(answerGuardian(active));
 for(const state of [initial,step(initial,'record_usage',{seconds:60}),active,failed,rest,finished]){
  const old=legacy(state),text=JSON.stringify(old),restored=decodeGuardianLifecycle(text);
  assert.equal(restored.schemaVersion,2);assert.equal(restored.revision,state.revision);assert.equal(restored.round,state.round);assert.equal(restored.dailyUsageSeconds,getGuardianView(state).dailySeconds);
  assert.deepEqual(restored,state);assert.equal(JSON.parse(text).schemaVersion,1);assert.equal(JSON.parse(encodeGuardianLifecycle(old)).schemaVersion,2);
 }
 const corrupt=legacy(initial);corrupt.stage.session.dailySeconds=7201;rejects(()=>decodeGuardianLifecycle(JSON.stringify(corrupt)));
 const extra=legacy(initial);extra.pendingPolicy=null;rejects(()=>decodeGuardianLifecycle(JSON.stringify(extra)));
});

test('schema2 corruption and invalid policies never reset accounting or grants',()=>{
 const state=set(step(freshGuardian(),'record_usage',{seconds:1200}),{dailyLimitMinutes:15});
 for(const mutate of [s=>delete s.dailyUsageSeconds,s=>s.dailyUsageSeconds=-1,s=>s.dailyUsageSeconds=36001,s=>s.dailyUsageSeconds=600,s=>s.pendingPolicy={...s.policy},s=>s.policy.restMinutes=-1,s=>s.stage.session.policy.grade=6]){
  const bad=structuredClone(state);mutate(bad);rejects(()=>decodeGuardianLifecycle(JSON.stringify(bad)));
 }
 for(const changes of [{requiredCorrect:6},{grade:7},{subjects:['science']},{dailyLimitMinutes:14},{unknown:true}])rejects(()=>set(state,changes));
 const active=beginGuardian(freshGuardian()),bad=structuredClone(active);bad.policy.grade=6;rejects(()=>decodeGuardianLifecycle(JSON.stringify(bad)));
});
