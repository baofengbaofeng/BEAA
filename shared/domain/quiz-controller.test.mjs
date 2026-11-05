import test from 'node:test';
import assert from 'node:assert/strict';
import { Phase } from './engine.mjs';
import { getLearningStats } from './learning-history.mjs';
import { QuizProgressError,encodeQuizProgress,decodeQuizProgress } from './quiz-progress.mjs';
import { commitQuizAnswer } from './quiz-controller.mjs';
import { fresh,command,advance } from '../../tests/helpers/quiz-progress-fixture.mjs';

// A test-only atomic port; it does not model native storage durability or device crashes.
class MemoryStore {
 constructor(progress){this.text=encodeQuizProgress(progress);this.writes=0;}
 async read(){return this.text;}
 async compareAndSwap(expected,text){
  const current=decodeQuizProgress(this.text);
  if(current.attemptId!==expected.attemptId || current.revision!==expected.revision)return false;
  this.text=text;this.writes++;return true;
 }
}
const rejects=(fn,code)=>assert.rejects(fn,e=>e instanceof QuizProgressError && (!code || e.code===code));

test('controller returns only acknowledged answer feedback and coupled completion',async()=>{
 const progress=advance(fresh(),4),store=new MemoryStore(progress);
 const result=await commitQuizAnswer(store,command(progress));const persisted=decodeQuizProgress(store.text);
 assert.deepEqual(Object.keys(result).sort(),['archiveOutcome','feedback','outcome','phase','revision']);
 assert.equal(result.outcome,'committed');assert.equal(result.phase,Phase.REST_REQUIRED);assert.equal(result.archiveOutcome,'added');
 assert.equal(result.revision,5);assert.equal(store.writes,1);assert.equal(persisted.revision,5);
 assert.equal(getLearningStats(persisted.history).quizCount,1);assert.equal(persisted.attempt.session.dailySeconds,1800);
});

test('a failure before the write leaves both answer and archive at the prior revision',async()=>{
 const progress=advance(fresh(),4),store=new MemoryStore(progress),before=store.text;
 store.compareAndSwap=async()=>{throw new Error('injected write failure');};
 await rejects(()=>commitQuizAnswer(store,command(progress)),'STORE_FAILURE');assert.equal(store.text,before);
 assert.equal(decodeQuizProgress(store.text).revision,4);assert.equal(getLearningStats(decodeQuizProgress(store.text).history).quizCount,0);
});

test('a committed final answer with lost acknowledgement retries without a second write',async()=>{
 const progress=advance(fresh(),4),store=new MemoryStore(progress),submit=command(progress),cas=store.compareAndSwap.bind(store);
 store.compareAndSwap=async(...args)=>{await cas(...args);throw new Error('injected acknowledgement loss');};
 await rejects(()=>commitQuizAnswer(store,submit),'STORE_FAILURE');
 assert.equal(decodeQuizProgress(store.text).revision,5);assert.equal(store.writes,1);
 const retried=await commitQuizAnswer(store,submit);
 assert.equal(retried.outcome,'duplicate');assert.equal(retried.phase,Phase.REST_REQUIRED);assert.equal(store.writes,1);
 assert.equal(getLearningStats(decodeQuizProgress(store.text).history).quizCount,1);
});

test('concurrent different choices cannot both commit or overwrite the winning first answer',async()=>{
 const progress=fresh(),store=new MemoryStore(progress),first=command(progress),different=command(progress,{wrong:true});
 const results=await Promise.allSettled([commitQuizAnswer(store,first),commitQuizAnswer(store,different)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='CONFLICT').length,1);
 assert.equal(store.writes,1);const stored=decodeQuizProgress(store.text);assert.equal(stored.revision,1);
 const winner=results[0].status==='fulfilled'?first:different,loser=winner===first?different:first;
 assert.equal(stored.attempt.session.challenge.answers[0].chosen,winner.chosen);
 await rejects(()=>commitQuizAnswer(store,loser),'CONFLICT');assert.equal(store.writes,1);
});

test('concurrent identical final submissions commit once, and retry the loser as duplicate',async()=>{
 const progress=advance(fresh(),4),store=new MemoryStore(progress),submit=command(progress);
 const results=await Promise.allSettled([commitQuizAnswer(store,submit),commitQuizAnswer(store,submit)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='CONFLICT').length,1);
 assert.equal((await commitQuizAnswer(store,submit)).outcome,'duplicate');assert.equal(store.writes,1);
 assert.equal(getLearningStats(decodeQuizProgress(store.text).history).quizCount,1);
});

test('CAS also checks round identity when revision is unchanged',async()=>{
 const first=fresh(),second=fresh('round-2'),store=new MemoryStore(first),cas=store.compareAndSwap.bind(store);
 store.compareAndSwap=async(expected,text)=>{store.text=encodeQuizProgress(second);return cas(expected,text);};
 await rejects(()=>commitQuizAnswer(store,command(first)),'CONFLICT');
 assert.equal(decodeQuizProgress(store.text).attemptId,'round-2');assert.equal(store.writes,0);
});

test('read failures, corrupt or missing data never create replacement progress',async()=>{
 const p=fresh(),store=new MemoryStore(p),before=store.text;
 store.read=async()=>{throw new Error('unavailable');};await rejects(()=>commitQuizAnswer(store,command(p)),'STORE_FAILURE');
 for(const text of [null,'{corrupt','{}']){store.read=async()=>text;await rejects(()=>commitQuizAnswer(store,command(p)),'INVALID_PROGRESS');}
 assert.equal(store.text,before);assert.equal(store.writes,0);
});

test('malformed commit responses and incomplete ports are not mistaken for successful commits',async()=>{
 const progress=fresh();
 for(const value of [null,undefined,1,'true',{}]){
  const store=new MemoryStore(progress);store.compareAndSwap=async()=>value;
  await rejects(()=>commitQuizAnswer(store,command(progress)),'STORE_FAILURE');assert.equal(store.writes,0);
 }
 const conflict=new MemoryStore(progress);conflict.compareAndSwap=async()=>false;await rejects(()=>commitQuizAnswer(conflict,command(progress)),'CONFLICT');
 for(const invalid of [null,{}, {read:async()=>''}])await rejects(()=>commitQuizAnswer(invalid,command(progress)),'INVALID_STORE');
});

test('answer command is captured before asynchronous storage read',async()=>{
 const progress=fresh(),store=new MemoryStore(progress),submit=command(progress),original=structuredClone(submit);let release;
 store.read=()=>new Promise(resolve=>{release=()=>resolve(store.text);});
 const pending=commitQuizAnswer(store,submit);submit.chosen=command(progress,{wrong:true}).chosen;release();
 await pending;assert.equal(decodeQuizProgress(store.text).attempt.session.challenge.answers[0].chosen,original.chosen);
});
