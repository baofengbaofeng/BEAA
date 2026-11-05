import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Phase,createSession,recordUsage,finishRest,rollDay } from './engine.mjs';
import { QuizError } from '../quiz/bank.mjs';
import { startQuiz,getCurrentQuestion,getQuizReview,submitQuizAnswer,validateQuizAttempt,encodeQuizAttempt,decodeQuizAttempt } from './quiz-service.mjs';
const sample=JSON.parse(readFileSync(new URL('../quiz/sample-questions.json',import.meta.url),'utf8'));
const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const due=()=>recordUsage(createSession(policy,'2026-11-04'),1800);
const begin=()=>startQuiz(due(),sample);
const answer=(attempt,wrong=false)=>{
 const current=getCurrentQuestion(attempt),q=attempt.questions.find(q=>q.id===current.id);
 const chosen=wrong?q.options.find(o=>o.id!==q.correctOptionId).id:q.correctOptionId;
 return submitQuizAnswer(attempt,{questionId:q.id,chosen});
};
const rejected=(operation)=>assert.throws(operation,e=>e instanceof QuizError);

test('quiz assembly starts a challenge and presents question data without answer keys',()=>{
 const attempt=begin();const publicQuestion=getCurrentQuestion(attempt);
 assert.equal(attempt.session.phase,Phase.CHALLENGE_ACTIVE);assert.equal(attempt.questions.length,5);
 assert.equal(Object.hasOwn(publicQuestion,'correctOptionId'),false);assert.equal(Object.hasOwn(publicQuestion,'explanation'),false);
 publicQuestion.options[0].text='changed';assert.notEqual(getCurrentQuestion(attempt).options[0].text,'changed');
});

test('only eligible sessions can start quizzes',()=>{
 rejected(()=>startQuiz(createSession(policy,'2026-11-04'),sample));
 rejected(()=>startQuiz(recordUsage(createSession(policy,'2026-11-04'),7200),sample));
 rejected(()=>startQuiz(due(),sample,{knowledgePoints:['missing']}));
});

test('grading uses the pinned bank key and rejects client-supplied correctness fields',()=>{
 const bank=structuredClone(sample);const attempt=startQuiz(due(),bank);const q=attempt.questions[0];
 bank.questions.find(item=>item.id===q.id).correctOptionId=q.options.find(o=>o.id!==q.correctOptionId).id;
 const result=submitQuizAnswer(attempt,{questionId:q.id,chosen:q.correctOptionId});
 assert.equal(result.feedback.correct,true);assert.equal(result.attempt.session.challenge.answers.length,1);
 assert.equal(attempt.session.challenge.answers.length,0);
 rejected(()=>submitQuizAnswer(attempt,{questionId:q.id,chosen:q.correctOptionId,correct:true}));
 rejected(()=>submitQuizAnswer(attempt,{questionId:q.id,chosen:q.correctOptionId,expected:q.correctOptionId}));
});

test('wrong answers return explanations and a failed strict round can retry without a grant',()=>{
 let attempt=begin();const wrong=answer(attempt,true);assert.equal(wrong.feedback.correct,false);assert.ok(wrong.feedback.explanation);
 attempt=wrong.attempt;while(attempt.session.phase===Phase.CHALLENGE_ACTIVE)attempt=answer(attempt).attempt;
 assert.equal(attempt.session.phase,Phase.CHALLENGE_REQUIRED);assert.equal(attempt.session.pendingGrant,false);
 const retry=startQuiz(attempt.session,sample);assert.equal(retry.session.challenge.answers.length,0);
});

test('unknown options, stale questions and malformed submissions never mutate progress',()=>{
 const attempt=begin(),q=getCurrentQuestion(attempt);const after=answer(attempt).attempt;
 for(const submission of [{questionId:q.id,chosen:'missing'},{questionId:'missing',chosen:q.options[0].id},null])rejected(()=>submitQuizAnswer(attempt,submission));
 rejected(()=>submitQuizAnswer(after,{questionId:q.id,chosen:q.options[0].id}));
 assert.equal(attempt.session.challenge.answers.length,0);assert.equal(after.session.challenge.answers.length,1);
});

test('quiz disk snapshots retain question keys and resume grading through rest and daily guards',t=>{
 const directory=mkdtempSync(join(tmpdir(),'beaa-quiz-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const file=join(directory,'quiz.json');
 let attempt=answer(begin()).attempt;const before=structuredClone(attempt);
 writeFileSync(file,encodeQuizAttempt(attempt,9),{mode:0o600});
 const recovered=decodeQuizAttempt(readFileSync(file,'utf8'));assert.equal(recovered.revision,9);assert.deepEqual(recovered.attempt,before);
 attempt=recovered.attempt;while(attempt.session.phase===Phase.CHALLENGE_ACTIVE)attempt=answer(attempt).attempt;
 assert.equal(attempt.session.phase,Phase.REST_REQUIRED);assert.equal(getCurrentQuestion(attempt),null);
 const rest=decodeQuizAttempt(encodeQuizAttempt(attempt)).attempt;
 assert.throws(()=>finishRest(rest.session,599));const available=finishRest(rest.session,600);
 assert.equal(available.dailySeconds,1800);assert.equal(recordUsage(available,7200).phase,Phase.DAILY_LOCKED);
});

test('restored attempt verifies stored scores against the pinned answer key',()=>{
 const attempt=answer(begin(),true).attempt;const forged=structuredClone(attempt);forged.session.challenge.answers[0].correct=true;
 rejected(()=>validateQuizAttempt(forged));
 const mismatched=structuredClone(attempt);mismatched.questions.reverse();rejected(()=>validateQuizAttempt(mismatched));
 const grade=structuredClone(attempt);grade.questions[0].grade=1;rejected(()=>validateQuizAttempt(grade));
});

test('quiz snapshot errors fail explicitly without falling back to a new attempt',()=>{
 for(const text of ['{broken','null','[]','{}'])rejected(()=>decodeQuizAttempt(text));
 const encoded=JSON.parse(encodeQuizAttempt(begin()));encoded.schemaVersion=2;rejected(()=>decodeQuizAttempt(JSON.stringify(encoded)));
 assert.throws(()=>decodeQuizAttempt(' '.repeat(1000001)),e=>e.code==='SNAPSHOT_TOO_LARGE');
 rejected(()=>encodeQuizAttempt(begin(),-1));
});

test('cross-day quiz recovery preserves already graded answers and needs no current bank file',()=>{
 const first=answer(begin()).attempt;
 const next={...first,session:rollDay(first.session,'2026-11-05')};
 const restored=decodeQuizAttempt(encodeQuizAttempt(next)).attempt;
 assert.equal(restored.session.dailySeconds,0);assert.equal(restored.session.challenge.answers.length,1);
 assert.equal(answer(restored).attempt.session.challenge.answers.length,2);
});


test('review reveals feedback only for answered questions and remains isolated',()=>{
 const attempt=answer(begin(),true).attempt;const review=getQuizReview(attempt);
 assert.equal(review.length,1);assert.equal(review[0].question.id,attempt.questions[0].id);
 assert.equal(review[0].correct,false);assert.equal(review[0].correctOptionId,attempt.questions[0].correctOptionId);assert.ok(review[0].explanation);
 assert.notEqual(review[0].question.id,getCurrentQuestion(attempt).id);
 review[0].question.options[0].text='changed';assert.notEqual(attempt.questions[0].options[0].text,'changed');
});
