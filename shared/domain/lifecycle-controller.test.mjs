import test from 'node:test';
import assert from 'node:assert/strict';
import { GuardianError,applyGuardianCommand,decodeGuardianLifecycle,encodeGuardianLifecycle,getGuardianSession } from './guardian-lifecycle.mjs';
import { getLearningStats } from './learning-history.mjs';
import { commitGuardianCommand } from './lifecycle-controller.mjs';
import { bank,freshGuardian,cmd,step,beginGuardian,answerCmd,answerGuardian,observeGuardian,completeCmd } from '../../tests/helpers/guardian-fixture.mjs';
// Test-only atomic storage. Native persistence and process/power-loss behavior are not modeled.
class MemoryStore {
 constructor(s){this.text=encodeGuardianLifecycle(s);this.writes=0;}
 async read(){return this.text;}
 async compareAndSwap(expected,text){
  const current=decodeGuardianLifecycle(this.text);
  if(current.lifecycleId!==expected.lifecycleId || current.revision!==expected.revision)return false;
  this.text=text;this.writes++;return true;
 }
}
const rejects=(fn,code)=>assert.rejects(fn,e=>e instanceof GuardianError && (!code || e.code===code));
function lastAnswer(){let s=beginGuardian(freshGuardian());for(let i=0;i<4;i++)s=applyGuardianCommand(s,answerCmd(s)).state;return s;}

test('acknowledged final-answer commit stores archive and rest together',async()=>{
 const s=lastAnswer(),store=new MemoryStore(s),result=await commitGuardianCommand(store,answerCmd(s));
 const persisted=decodeGuardianLifecycle(store.text);assert.equal(persisted.stage.kind,'rest');assert.equal(persisted.history.records.length,1);
 assert.equal(result.outcome,'committed');assert.equal(result.phase,'REST_REQUIRED');assert.equal(result.feedback.correct,true);assert.equal(store.writes,1);
 assert.equal(Object.hasOwn(result,'history'),false);assert.equal(Object.hasOwn(result,'stage'),false);
});

test('failure before either boundary commit cannot partially archive or finish rest',async()=>{
 for(const s of [lastAnswer(),observeGuardian(answerGuardian(beginGuardian(freshGuardian())))]){
  const store=new MemoryStore(s),before=store.text,event=s.stage.kind==='quiz'?answerCmd(s):completeCmd(s);
  store.compareAndSwap=async()=>{throw new Error('injected pre-write failure');};
  await rejects(()=>commitGuardianCommand(store,event),'STORE_FAILURE');assert.equal(store.text,before);assert.equal(store.writes,0);
 }
});

test('lost acknowledgements at both phase boundaries retry from the single committed snapshot',async()=>{
 for(const s of [lastAnswer(),observeGuardian(answerGuardian(beginGuardian(freshGuardian())))]){
  const store=new MemoryStore(s),event=s.stage.kind==='quiz'?answerCmd(s):completeCmd(s),cas=store.compareAndSwap.bind(store);
  store.compareAndSwap=async(...args)=>{await cas(...args);throw new Error('injected lost acknowledgement');};
  await rejects(()=>commitGuardianCommand(store,event),'STORE_FAILURE');assert.equal(store.writes,1);
  const persisted=decodeGuardianLifecycle(store.text);assert.equal(persisted.stage.kind,s.stage.kind==='quiz'?'rest':'session');
  const retry=await commitGuardianCommand(store,event);assert.equal(retry.outcome,'duplicate');assert.equal(store.writes,1);
  assert.equal(getLearningStats(persisted.history).quizCount,1);assert.equal(getGuardianSession(persisted).dailySeconds,1800);
 }
});

test('concurrent different answers commit only one original selection',async()=>{
 const s=beginGuardian(freshGuardian()),store=new MemoryStore(s),first=answerCmd(s),other=answerCmd(s,true);
 other.eventId='different-selection';const results=await Promise.allSettled([commitGuardianCommand(store,first),commitGuardianCommand(store,other)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='CONFLICT').length,1);assert.equal(store.writes,1);
 const winner=results[0].status==='fulfilled'?first:other;
 assert.equal(decodeGuardianLifecycle(store.text).stage.progress.attempt.session.challenge.answers[0].chosen,winner.payload.chosen);
});

test('concurrent completions cannot create two grants and the loser can retry as duplicate',async()=>{
 const s=observeGuardian(answerGuardian(beginGuardian(freshGuardian()))),store=new MemoryStore(s),event=completeCmd(s);
 const results=await Promise.allSettled([commitGuardianCommand(store,event),commitGuardianCommand(store,event)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='CONFLICT').length,1);
 assert.equal((await commitGuardianCommand(store,event)).outcome,'duplicate');assert.equal(store.writes,1);
});

test('a replacement lifecycle at the same revision cannot pass the old CAS identity',async()=>{
 const s=freshGuardian(),other=structuredClone(s);other.lifecycleId='different-ledger';const store=new MemoryStore(s),cas=store.compareAndSwap.bind(store);
 store.compareAndSwap=async(expected,text)=>{store.text=encodeGuardianLifecycle(other);return cas(expected,text);};
 await rejects(()=>commitGuardianCommand(store,cmd(s,'record_usage',{seconds:1})),'CONFLICT');assert.equal(store.writes,0);
 assert.equal(decodeGuardianLifecycle(store.text).lifecycleId,'different-ledger');
});

test('missing, corrupt or unavailable storage never starts a new ledger',async()=>{
 const s=freshGuardian(),store=new MemoryStore(s),before=store.text,event=cmd(s,'record_usage',{seconds:1});
 store.read=async()=>{throw new Error('unavailable');};await rejects(()=>commitGuardianCommand(store,event),'STORE_FAILURE');
 for(const text of [null,'{broken','{}']){store.read=async()=>text;await rejects(()=>commitGuardianCommand(store,event),'INVALID_LIFECYCLE');}
 assert.equal(store.text,before);assert.equal(store.writes,0);
 for(const invalid of [null,{}, {read:async()=>''}])await rejects(()=>commitGuardianCommand(invalid,event),'INVALID_STORE');
 for(const response of [undefined,null,1,'true',{}]){const invalid=new MemoryStore(s);invalid.compareAndSwap=async()=>response;await rejects(()=>commitGuardianCommand(invalid,event),'STORE_FAILURE');}
});

test('command and bank context are copied before an asynchronous read',async()=>{
 const s=step(freshGuardian(),'record_usage',{seconds:1800}),store=new MemoryStore(s),event=cmd(s,'begin_quiz',{knowledgePoints:[]}),context={bank:structuredClone(bank)};let release;
 const original=context.bank.questions[0].correctOptionId;
 store.read=()=>new Promise(resolve=>{release=()=>resolve(store.text);});const pending=commitGuardianCommand(store,event,context);
 context.bank.questions[0].correctOptionId=context.bank.questions[0].options.find(o=>o.id!==original).id;event.payload.knowledgePoints.push('missing-topic');release();
 const result=await pending,persisted=decodeGuardianLifecycle(store.text);
 assert.equal(persisted.stage.progress.attempt.questions.find(q=>q.id===bank.questions[0].id).correctOptionId,original);
 assert.equal(result.feedback,null);assert.equal(Object.hasOwn(result.question,'correctOptionId'),false);
});
