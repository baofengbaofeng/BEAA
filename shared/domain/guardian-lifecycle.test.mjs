import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Phase } from './engine.mjs';
import { getLearningStats } from './learning-history.mjs';
import { GuardianError,createGuardianLifecycle,validateGuardianLifecycle,applyGuardianCommand,getGuardianSession,getGuardianView,encodeGuardianLifecycle,decodeGuardianLifecycle } from './guardian-lifecycle.mjs';
import { bank,policy,freshGuardian,cmd,step,beginGuardian,answerCmd,answerGuardian,observeGuardian,completeCmd,finishGuardian } from '../../tests/helpers/guardian-fixture.mjs';
const rejects=(fn,code)=>assert.throws(fn,e=>e instanceof GuardianError && (!code || e.code===code));

test('new lifecycle starts a separate protected ledger and copies public views',()=>{
 const s=freshGuardian(),clone=validateGuardianLifecycle(s);assert.equal(s.revision,0);assert.equal(s.round,0);assert.equal(s.lastReceipt,null);
 assert.equal(getGuardianSession(s).phase,Phase.AVAILABLE);clone.history.limit=1;assert.equal(s.history.limit,200);
 const q=beginGuardian(s),view=getGuardianView(q);assert.ok(view.question);assert.equal(Object.hasOwn(view.question,'correctOptionId'),false);
 view.question.options[0].text='changed';assert.notEqual(getGuardianView(q).question.options[0].text,'changed');
 for(const id of ['', ' x ', 'x'.repeat(97)])rejects(()=>createGuardianLifecycle(id,policy,'2026-11-05'));
});

test('last answer, history archive and rest creation form one transition',()=>{
 let s=beginGuardian(freshGuardian());for(let i=0;i<4;i++)s=applyGuardianCommand(s,answerCmd(s)).state;
 const before=structuredClone(s),event=answerCmd(s),result=applyGuardianCommand(s,event);s=result.state;
 assert.equal(s.stage.kind,'rest');assert.equal(s.stage.progress.restId,`${s.lifecycleId}/round/1`);
 assert.equal(getGuardianSession(s).phase,Phase.REST_REQUIRED);assert.equal(getGuardianSession(s).dailySeconds,1800);
 assert.equal(getLearningStats(s.history).quizCount,1);assert.equal(result.feedback.correct,true);assert.deepEqual(before.stage.progress.revision,4);
 assert.deepEqual(s.stage.progress.sourceSession,s.stage.quiz.attempt.session);assert.equal(s.stage.progress.revision,0);
 assert.deepEqual(applyGuardianCommand(s,event).state,s);assert.equal(applyGuardianCommand(s,event).duplicate,true);
 assert.equal(before.history.records.length,0);assert.equal(before.stage.kind,'quiz');
});

test('rest completion returns to a session while retaining history and the global revision',()=>{
 const resting=answerGuardian(beginGuardian(freshGuardian()));
 rejects(()=>applyGuardianCommand(resting,completeCmd(resting)),'REST_NOT_COMPLETE');
 const ready=observeGuardian(resting),event=completeCmd(ready),result=applyGuardianCommand(ready,event),s=result.state;
 assert.equal(s.stage.kind,'session');assert.equal(getGuardianSession(s).phase,Phase.AVAILABLE);assert.equal(getGuardianSession(s).dailySeconds,1800);
 assert.equal(getGuardianSession(s).cycleSeconds,0);assert.equal(getLearningStats(s.history).quizCount,1);assert.equal(s.revision,ready.revision+1);
 assert.equal(applyGuardianCommand(s,event).duplicate,true);assert.deepEqual(applyGuardianCommand(s,event).state,s);
 const second=beginGuardian(s);assert.equal(second.round,2);assert.equal(getGuardianSession(second).dailySeconds,3600);assert.ok(second.revision>s.revision);
});

test('four thirty-minute usage cycles hit the daily hard cap and cannot start another quiz',()=>{
 let s=freshGuardian();for(let i=0;i<3;i++)s=finishGuardian(answerGuardian(beginGuardian(s)));
 assert.equal(getGuardianSession(s).dailySeconds,5400);s=step(s,'record_usage',{seconds:1800});
 assert.equal(getGuardianSession(s).phase,Phase.DAILY_LOCKED);assert.equal(getGuardianSession(s).dailySeconds,7200);assert.equal(getLearningStats(s.history).quizCount,3);
 rejects(()=>step(s,'begin_quiz',{knowledgePoints:[]}),'INVALID_STATE');rejects(()=>step(s,'record_usage',{seconds:1}),'INVALID_STATE');
 s=step(s,'roll_day',{nextDay:'2026-11-06'});assert.equal(getGuardianSession(s).phase,Phase.CHALLENGE_REQUIRED);assert.equal(getGuardianSession(s).dailySeconds,0);
 assert.equal(step(s,'begin_quiz',{knowledgePoints:[]}).round,4);
});

test('failed quizzes retain their record and retry in a new round without extra usage eligibility',()=>{
 let s=answerGuardian(beginGuardian(freshGuardian()),true);assert.equal(s.stage.kind,'quiz');assert.equal(getGuardianSession(s).phase,Phase.CHALLENGE_REQUIRED);
 assert.equal(getLearningStats(s.history).passedQuizCount,0);assert.equal(getGuardianSession(s).dailySeconds,1800);
 rejects(()=>step(s,'record_usage',{seconds:1}),'INVALID_STATE');rejects(()=>applyGuardianCommand(s,cmd(s,'complete_rest',{checkpoint:{bootId:'b',monotonicMs:1}})),'INVALID_STATE');
 s=step(s,'begin_quiz',{knowledgePoints:[]});assert.equal(s.round,2);assert.equal(getGuardianSession(s).dailySeconds,1800);
 s=answerGuardian(s);assert.equal(getLearningStats(s.history).quizCount,2);assert.equal(getLearningStats(s.history).passedQuizCount,1);
});

test('calendar rollover preserves a partial quiz and uses the completion date for its record',()=>{
 let s=beginGuardian(freshGuardian());for(let i=0;i<2;i++)s=applyGuardianCommand(s,answerCmd(s)).state;
 s=step(s,'roll_day',{nextDay:'2026-11-06'});assert.equal(s.stage.progress.revision,2);assert.equal(getGuardianSession(s).dailySeconds,0);
 assert.equal(getGuardianSession(s).phase,Phase.CHALLENGE_ACTIVE);s=answerGuardian(s);
 assert.equal(s.history.records[0].dayKey,'2026-11-06');assert.equal(getGuardianSession(s).phase,Phase.REST_REQUIRED);
});

test('calendar rollover during rest preserves original record and requires actual rest evidence',()=>{
 let s=answerGuardian(beginGuardian(freshGuardian()));s=step(s,'roll_day',{nextDay:'2026-11-06'});
 assert.equal(getGuardianSession(s).dayKey,'2026-11-06');assert.equal(getGuardianSession(s).dailySeconds,0);
 assert.equal(s.history.records[0].dayKey,'2026-11-05');assert.equal(s.stage.quiz.attempt.session.dayKey,'2026-11-05');
 assert.equal(getGuardianSession(s).phase,Phase.REST_REQUIRED);rejects(()=>applyGuardianCommand(s,completeCmd(s)),'REST_NOT_COMPLETE');
 s=finishGuardian(s);assert.equal(getGuardianSession(s).dayKey,'2026-11-06');assert.equal(getGuardianSession(s).dailySeconds,0);
 assert.equal(s.history.records[0].dayKey,'2026-11-05');
});

test('failed quiz keeps its completion day while a later retry uses the current calendar',()=>{
 let s=answerGuardian(beginGuardian(freshGuardian()),true);s=step(s,'roll_day',{nextDay:'2026-11-06'});
 assert.equal(s.history.records[0].dayKey,'2026-11-05');assert.equal(getGuardianSession(s).dailySeconds,0);
 s=step(s,'begin_quiz',{knowledgePoints:[]});assert.equal(s.stage.progress.attempt.session.dayKey,'2026-11-06');
});

test('bounded history eviction never resets round identity or accepts an old same-question command',()=>{
 let s=freshGuardian();s.history.limit=1;s=beginGuardian(s);const old=answerCmd(s);
 for(let i=0;i<3;i++){s=finishGuardian(answerGuardian(s));if(i<2)s=beginGuardian(s);}
 assert.equal(s.history.records.length,1);assert.equal(s.round,3);s=step(s,'roll_day',{nextDay:'2026-11-06'});s=beginGuardian(s);
 assert.equal(s.round,4);assert.equal(answerCmd(s).payload.questionId,old.payload.questionId);rejects(()=>applyGuardianCommand(s,old),'CONFLICT');
 assert.equal(s.stage.progress.attemptId,`${s.lifecycleId}/round/4`);
});

test('recent command receipts are canonical and conflict with changed content or revision',()=>{
 const initial=freshGuardian(),event=cmd(initial,'record_usage',{seconds:60}),s=applyGuardianCommand(initial,event).state;
 const reordered=Object.fromEntries(Object.entries(event).reverse());assert.equal(applyGuardianCommand(s,reordered).duplicate,true);
 rejects(()=>applyGuardianCommand(s,{...event,payload:{seconds:120}}),'CONFLICT');
 rejects(()=>applyGuardianCommand(s,{...event,eventId:'other'}),'CONFLICT');
 rejects(()=>step(s,'roll_day',{nextDay:'2026-02-30'}));rejects(()=>step(s,'roll_day',{nextDay:'2026-11-05'}));
 const q=beginGuardian(initial),a=answerCmd(q);rejects(()=>applyGuardianCommand(q,{...a,payload:{...a.payload,correct:true}}));
 rejects(()=>applyGuardianCommand(q,{...a,lifecycleId:'other'}),'CONFLICT');
});

test('a single file roundtrip preserves pending rest, history and completion retry receipt',()=>{
 const dir=mkdtempSync(join(tmpdir(),'beaa-guardian-'));
 try{const file=join(dir,'state.json'),resting=observeGuardian(answerGuardian(beginGuardian(freshGuardian())),300000);
 writeFileSync(file,encodeGuardianLifecycle(resting),{mode:0o600});let s=decodeGuardianLifecycle(readFileSync(file,'utf8'));
 assert.equal(getGuardianView(s).rest.remainingSeconds,300);s=observeGuardian(s,300000);const event=completeCmd(s);s=applyGuardianCommand(s,event).state;
 writeFileSync(file,encodeGuardianLifecycle(s),{mode:0o600});s=decodeGuardianLifecycle(readFileSync(file,'utf8'));
 assert.equal(applyGuardianCommand(s,event).duplicate,true);assert.equal(getLearningStats(s.history).quizCount,1);assert.equal(getGuardianSession(s).dailySeconds,1800);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('corrupt stage, history, source association or receipt is rejected without replacement',()=>{
 const s=answerGuardian(beginGuardian(freshGuardian()));
 for(const mutate of [x=>x.round++,x=>x.history.records=[],x=>x.stage.progress.sourceSession.dailySeconds++,x=>x.stage.quiz.attemptId='wrong',x=>x.stage.progress.restId='wrong',x=>x.stage.quiz.history=x.history,x=>x.calendarDay='2026-11-04',x=>x.lastReceipt.command.expectedRevision--,x=>x.lastReceipt.feedback.correct=false,x=>delete x.stage.quiz.attempt.questions[0].knowledgePoints,x=>x.stage.progress.completion={bootId:x.stage.progress.bootId,monotonicMs:x.stage.progress.cursorMs},x=>x.extra=true]){
  const bad=structuredClone(s);mutate(bad);rejects(()=>decodeGuardianLifecycle(JSON.stringify(bad)));
 }
 for(const text of ['{','null','[]','{}'])rejects(()=>decodeGuardianLifecycle(text));
 const version=structuredClone(s);version.schemaVersion=3;rejects(()=>decodeGuardianLifecycle(JSON.stringify(version)),'UNSUPPORTED_VERSION');
 rejects(()=>decodeGuardianLifecycle(' '.repeat(8000001)),'SNAPSHOT_TOO_LARGE');assert.equal(getLearningStats(s.history).quizCount,1);
});

test('global revision exhaustion is explicit and never rounds into a reused CAS version',()=>{
 const s=step(freshGuardian(),'record_usage',{seconds:0});s.revision=Number.MAX_SAFE_INTEGER;s.lastReceipt.command.expectedRevision=s.revision-1;
 validateGuardianLifecycle(s);rejects(()=>step(s,'record_usage',{seconds:1}),'COUNTER_EXHAUSTED');
});

test('a new ledger cannot contain unrecorded usage or history before its first event',()=>{
 const initial=freshGuardian();
 const usage=structuredClone(initial);usage.stage.session.dailySeconds=60;usage.stage.session.cycleSeconds=60;
 rejects(()=>decodeGuardianLifecycle(JSON.stringify(usage)));
 const history=structuredClone(initial);history.history=answerGuardian(beginGuardian(freshGuardian())).history;
 rejects(()=>decodeGuardianLifecycle(JSON.stringify(history)));
});

test('the rest-to-session completion receipt preserves the matching learning archive',()=>{
 const completed=finishGuardian(answerGuardian(beginGuardian(freshGuardian())));
 const broken=structuredClone(completed);broken.history.records=[];
 rejects(()=>decodeGuardianLifecycle(JSON.stringify(broken)));
});
