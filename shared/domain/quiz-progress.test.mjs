import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Phase,finishRest } from './engine.mjs';
import { getLearningStats,createLearningHistory } from './learning-history.mjs';
import { QuizProgressError,createQuizProgress,validateQuizProgress,submitProgressAnswer,encodeQuizProgress,decodeQuizProgress } from './quiz-progress.mjs';
import { fresh,command,advance } from '../../tests/helpers/quiz-progress-fixture.mjs';
const rejects=(fn,code)=>assert.throws(fn,e=>e instanceof QuizProgressError && (!code || e.code===code));

test('progress begins with an unanswered active quiz and independent snapshots',()=>{
 const p=fresh();assert.equal(p.revision,0);assert.equal(p.completion,null);
 assert.equal(p.history.records.length,0);assert.equal(p.attempt.session.phase,Phase.CHALLENGE_ACTIVE);
 const clone=validateQuizProgress(p);clone.attempt.questions[0].stem='changed';assert.notEqual(p.attempt.questions[0].stem,'changed');
 rejects(()=>createQuizProgress('round-1',advance(p).attempt));
 for(const id of ['', ' a ', 'x'.repeat(129)])rejects(()=>createQuizProgress(id,p.attempt));
});

test('answer progression and final archive are one state transition with rest still required',()=>{
 const p=advance(fresh(),4),before=structuredClone(p),submission=command(p);
 const {progress,duplicate,feedback}=submitProgressAnswer(p,submission);
 assert.equal(duplicate,false);assert.equal(feedback.questionId,submission.questionId);assert.equal(feedback.correct,true);
 assert.equal(progress.revision,5);assert.equal(progress.attempt.session.phase,Phase.REST_REQUIRED);
 assert.equal(progress.attempt.session.dailySeconds,1800);assert.equal(progress.attempt.session.pendingGrant,true);
 assert.deepEqual(progress.completion,{completedAt:1000,archiveOutcome:'added'});
 assert.equal(getLearningStats(progress.history).quizCount,1);assert.equal(getLearningStats(progress.history).correctCount,5);
 assert.deepEqual(p,before);rejects(()=>createQuizProgress('round-1',fresh().attempt,progress.history));
 assert.throws(()=>finishRest(progress.attempt.session,599));
});

test('failed quizzes archive without granting usage',()=>{
 const progress=advance(fresh(),5,{wrong:true});
 assert.equal(progress.attempt.session.phase,Phase.CHALLENGE_REQUIRED);assert.equal(progress.attempt.session.pendingGrant,false);
 assert.equal(progress.attempt.session.dailySeconds,1800);assert.equal(getLearningStats(progress.history).passedQuizCount,0);
 assert.equal(getLearningStats(progress.history).quizCount,1);
});

test('identical answered commands retry safely without adding answers or statistics',()=>{
 let progress=fresh();const first=command(progress);progress=submitProgressAnswer(progress,first).progress;
 const repeated=submitProgressAnswer(progress,first);assert.equal(repeated.duplicate,true);assert.deepEqual(repeated.progress,progress);
 progress=advance(progress,3);const last=command(progress);progress=submitProgressAnswer(progress,last).progress;
 const done=submitProgressAnswer(progress,last);assert.equal(done.duplicate,true);assert.equal(done.progress.revision,5);
 assert.equal(getLearningStats(done.progress.history).quizCount,1);
 const old=submitProgressAnswer(done.progress,first);assert.equal(old.duplicate,true);assert.equal(old.progress.revision,5);
 rejects(()=>submitProgressAnswer(done.progress,{...last,completedAt:1001}),'CONFLICT');
 const different=progress.attempt.questions[0].options.find(o=>o.id!==first.chosen).id;
 rejects(()=>submitProgressAnswer(progress,{...first,chosen:different}),'CONFLICT');
});

test('stale commands cannot target a new round that contains identical question IDs',()=>{
 const first=fresh(),old=command(first),second=fresh('round-2');
 assert.equal(old.questionId,command(second).questionId);rejects(()=>submitProgressAnswer(second,old),'CONFLICT');
 rejects(()=>submitProgressAnswer(first,{...old,expectedRevision:1}),'CONFLICT');
 rejects(()=>submitProgressAnswer(first,{...old,questionId:first.attempt.questions[1].id}),'INVALID_COMMAND');
});

test('command shape and completion timestamps are checked without accepting caller grades',()=>{
 const p=fresh(),c=command(p);
 for(const change of [x=>x.correct=true,x=>x.expectedRevision=-1,x=>x.expectedRevision=1.5,x=>x.chosen='unknown',x=>x.completedAt=1000,x=>delete x.questionId]){
  const bad={...c};change(bad);rejects(()=>submitProgressAnswer(p,bad));
 }
 const last=advance(p,4);
 for(const time of [null,-1,NaN,8_640_000_000_000_001])rejects(()=>submitProgressAnswer(last,command(last,{completedAt:time})));
});

test('an older completed event may be outside the retained history window',()=>{
 const newer=advance(fresh('newer',createLearningHistory(1)),5,{completedAt:2000});
 const older=advance(fresh('older',newer.history),5,{completedAt:1000});
 assert.deepEqual(older.completion,{completedAt:1000,archiveOutcome:'outside_window'});
 assert.deepEqual(older.history,newer.history);assert.deepEqual(decodeQuizProgress(encodeQuizProgress(older)),older);
});

test('completed progress restores from a real file as a coupled answer and history snapshot',()=>{
 const dir=mkdtempSync(join(tmpdir(),'beaa-progress-'));
 try{const p=advance(fresh(),4),last=command(p),done=submitProgressAnswer(p,last).progress,file=join(dir,'progress.json');
 writeFileSync(file,encodeQuizProgress(done),{mode:0o600});const restored=decodeQuizProgress(readFileSync(file,'utf8'));
 assert.deepEqual(restored,done);assert.equal(submitProgressAnswer(restored,last).duplicate,true);assert.equal(restored.attempt.session.phase,Phase.REST_REQUIRED);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('recovery rejects incomplete or contradictory archival state instead of repairing it',()=>{
 const done=advance(fresh(),5);
 for(const mutate of [p=>p.history.records=[],p=>p.revision=4,p=>p.completion=null,p=>p.completion.completedAt++,p=>p.completion.archiveOutcome='outside_window',p=>p.attemptId='different',p=>p.history.records[0].answers[0].chosen='unknown',p=>p.extra=true,p=>delete p.attempt.questions[0].knowledgePoints]){
  const bad=structuredClone(done);mutate(bad);rejects(()=>decodeQuizProgress(JSON.stringify(bad)));
 }
 const partial=advance(fresh());partial.completion={completedAt:1000,archiveOutcome:'added'};rejects(()=>validateQuizProgress(partial));
 const collision=fresh();collision.history=done.history;rejects(()=>validateQuizProgress(collision));
 for(const text of ['{','null','[]','{}'])rejects(()=>decodeQuizProgress(text));
 const version=structuredClone(done);version.schemaVersion=2;rejects(()=>decodeQuizProgress(JSON.stringify(version)),'UNSUPPORTED_VERSION');
 rejects(()=>decodeQuizProgress(' '.repeat(6_000_001)),'SNAPSHOT_TOO_LARGE');
 const invalidRevision=fresh();invalidRevision.revision=Number.MAX_SAFE_INTEGER;rejects(()=>validateQuizProgress(invalidRevision));
});
