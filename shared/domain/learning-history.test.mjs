import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession,recordUsage,Phase } from './engine.mjs';
import { startQuiz,submitQuizAnswer } from './quiz-service.mjs';
import { LearningHistoryError,createLearningHistory,validateLearningHistory,recordCompletedQuiz,listLearningRecords,getWrongAnswers,getLearningStats,encodeLearningHistory,decodeLearningHistory } from './learning-history.mjs';
const bank=JSON.parse(readFileSync(new URL('../quiz/sample-questions.json',import.meta.url),'utf8'));
const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:4,grade:3,subjects:['chinese','math','english']};
function quiz(wrong=[],{dayKey='2026-11-05',grade=3,tags=false}={}){
 const source=structuredClone(bank);source.questions.forEach(q=>{q.grade=grade;if(tags)q.knowledgePoints=['__proto__','constructor'];});
 let attempt=startQuiz(recordUsage(createSession({...policy,grade},dayKey),1800),source);
 for(const [i,q] of attempt.questions.entries())attempt=submitQuizAnswer(attempt,{questionId:q.id,chosen:wrong.includes(i)?q.options.find(o=>o.id!==q.correctOptionId).id:q.correctOptionId}).attempt;
 return attempt;
}
const meta=(attemptId='attempt-1',completedAt=1000)=>({attemptId,completedAt});
const add=(history,attempt=quiz(),id='attempt-1',time=1000)=>recordCompletedQuiz(history,attempt,meta(id,time)).history;
const rejects=(operation,code)=>assert.throws(operation,e=>e instanceof LearningHistoryError && (!code || e.code===code));

test('only complete validated attempts are archived without changing entitlement',()=>{
 const history=createLearningHistory(),attempt=quiz([0]);const before=structuredClone(attempt);
 const result=recordCompletedQuiz(history,attempt,meta());
 assert.equal(result.outcome,'added');assert.deepEqual(attempt,before);assert.deepEqual(history.records,[]);
 assert.equal(attempt.session.phase,Phase.REST_REQUIRED);
 assert.deepEqual(listLearningRecords(result.history),[{id:'attempt-1',completedAt:1000,dayKey:'2026-11-05',grade:3,questionCount:5,correctCount:4,requiredCorrect:4,passed:true}]);
 const failed=add(result.history,quiz([0,1]),'attempt-2',2000);
 assert.equal(listLearningRecords(failed)[0].passed,false);
 const partial=startQuiz(recordUsage(createSession(policy,'2026-11-05'),1800),bank);
 rejects(()=>add(history,partial));
 const forged=quiz();forged.session.challenge.answers[0].correct=false;rejects(()=>add(history,forged));
 rejects(()=>recordCompletedQuiz(history,attempt,{...meta(),correctCount:5}),'INVALID_METADATA');
});

test('retained event IDs are idempotent across object-key order and conflicts are explicit',()=>{
 const attempt=quiz(),history=add(createLearningHistory(),attempt);
 const reordered=structuredClone(attempt);reordered.questions[0]=Object.fromEntries(Object.entries(reordered.questions[0]).reverse());
 const result=recordCompletedQuiz(history,reordered,meta());assert.equal(result.outcome,'duplicate');assert.deepEqual(result.history,history);
 rejects(()=>recordCompletedQuiz(history,attempt,meta('attempt-1',1001)),'CONFLICT');
 rejects(()=>recordCompletedQuiz(history,quiz([0]),meta()),'CONFLICT');
 result.history.records[0].answers[0].chosen='changed';assert.notEqual(history.records[0].answers[0].chosen,'changed');
});

test('bounded history keeps newest completion events and handles late arrivals deterministically',()=>{
 const attempt=quiz();let history=createLearningHistory(2);
 history=add(history,attempt,'b',200);history=add(history,attempt,'c',300);
 const late=recordCompletedQuiz(history,attempt,meta('a',100));assert.equal(late.outcome,'outside_window');assert.deepEqual(late.history,history);
 history=add(history,attempt,'d',200);assert.deepEqual(history.records.map(r=>r.id),['d','c']);
 assert.deepEqual(listLearningRecords(history).map(r=>r.id),['c','d']);
 for(const limit of [0,201,1.5,NaN,'2'])rejects(()=>createLearningHistory(limit));
});

test('queries preserve historic wrong occurrences, filter results, and return independent copies',()=>{
 const first=quiz([0,1]),second=quiz([0],{grade:2,dayKey:'2026-11-06'});
 let history=add(createLearningHistory(),first);history=add(history,second,'attempt-2',2000);
 assert.equal(getWrongAnswers(history).length,3);
 assert.equal(listLearningRecords(history,{dayKey:'2026-11-05',grade:3}).length,1);
 const point=first.questions[0].knowledgePoints[0],subject=first.questions[0].subject;
 const wrong=getWrongAnswers(history,{grade:3,subject,knowledgePoint:point});assert.equal(wrong.length,1);
 assert.equal(wrong[0].attemptId,'attempt-1');assert.equal(wrong[0].question.id,first.questions[0].id);
 assert.equal(wrong[0].correctOptionId,first.questions[0].correctOptionId);assert.ok(wrong[0].explanation);
 wrong[0].question.options[0].text='changed';assert.notEqual(getWrongAnswers(history)[0].question.options[0].text,'changed');
 for(const query of [{grade:7},{dayKey:'2026-02-30'},{subject:'science'},{extra:true},null])rejects(()=>getWrongAnswers(history,query),'INVALID_QUERY');
 rejects(()=>getLearningStats(history,{subject:'math'}),'INVALID_QUERY');
});

test('statistics derive grades and pass rates from fixed answers and original thresholds',()=>{
 let history=add(createLearningHistory(),quiz([0]));history=add(history,quiz([0,1]),'attempt-2',2000);
 const stats=getLearningStats(history);assert.equal(stats.quizCount,2);assert.equal(stats.passedQuizCount,1);
 assert.equal(stats.answerCount,10);assert.equal(stats.correctCount,7);assert.equal(stats.accuracy,70);
 assert.deepEqual(stats.bySubject.chinese,{answerCount:2,correctCount:0,accuracy:0});
 assert.deepEqual(stats.bySubject.math,{answerCount:6,correctCount:5,accuracy:83});
 assert.equal(stats.byKnowledgePoint.find(p=>p.knowledgePoint==='arithmetic').answerCount,6);
 assert.equal(getLearningStats(history,{grade:2}).accuracy,null);
 const empty=getLearningStats(createLearningHistory());assert.equal(empty.quizCount,0);assert.equal(empty.accuracy,null);assert.equal(empty.bySubject.math.accuracy,null);
});

test('arbitrary knowledge-point labels cannot overwrite statistic object properties',()=>{
 const stats=getLearningStats(add(createLearningHistory(),quiz([0],{tags:true})));
 assert.deepEqual(stats.byKnowledgePoint,[{knowledgePoint:'__proto__',answerCount:5,correctCount:4,accuracy:80},{knowledgePoint:'constructor',answerCount:5,correctCount:4,accuracy:80}]);
});

test('history JSON survives a real file roundtrip without consulting the current bank',()=>{
 const history=add(createLearningHistory(),quiz([0]));const directory=mkdtempSync(join(tmpdir(),'beaa-history-'));
 try{const file=join(directory,'history.json');writeFileSync(file,encodeLearningHistory(history,7),{mode:0o600});const restored=decodeLearningHistory(readFileSync(file,'utf8'));
 assert.equal(restored.revision,7);assert.deepEqual(restored.history,history);assert.equal(getWrongAnswers(restored.history).length,1);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('corrupt history is rejected rather than silently cleared or repaired',()=>{
 const history=add(createLearningHistory(),quiz([0]));
 const changes=[h=>h.records[0].answers[0].chosen='missing',h=>h.records[0].answers[0].correct=true,h=>h.records[0].passed=true,h=>h.records[0].requiredCorrect=0,h=>h.records[0].dayKey='2026-02-30',h=>h.records[0].completedAt=-1,h=>h.records[0].questions[0].grade=2,h=>h.records[0].answers.reverse(),h=>h.records.push(structuredClone(h.records[0])),h=>h.limit=201,h=>h.records[0].questions.pop(),h=>delete h.records[0].questions[0].knowledgePoints,h=>h.extra=true,h=>delete h.records[0].answers[0]];
 for(const change of changes){const bad=structuredClone(history);change(bad);rejects(()=>validateLearningHistory(bad));}
 const ordered=add(history,quiz(),'attempt-2',2000);ordered.records.reverse();rejects(()=>validateLearningHistory(ordered));
 const beyond=add(history,quiz(),'attempt-2',2000);beyond.limit=1;rejects(()=>validateLearningHistory(beyond));
 for(const text of ['{','null','[]','{}'])rejects(()=>decodeLearningHistory(text));
 const envelope=JSON.parse(encodeLearningHistory(history));envelope.schemaVersion=2;rejects(()=>decodeLearningHistory(JSON.stringify(envelope)),'UNSUPPORTED_VERSION');
 envelope.schemaVersion=1;envelope.history.schemaVersion=2;rejects(()=>decodeLearningHistory(JSON.stringify(envelope)),'UNSUPPORTED_VERSION');
 for(const revision of [-1,1.5,Number.MAX_SAFE_INTEGER+1])rejects(()=>encodeLearningHistory(history,revision));
 rejects(()=>decodeLearningHistory(' '.repeat(5_000_001)),'SNAPSHOT_TOO_LARGE');
 assert.equal(getWrongAnswers(history).length,1);
});

test('metadata and query bounds are validated before persistence',()=>{
 for(const metadata of [meta('',100),meta(' a ',100),meta('a',NaN),meta('a',8_640_000_000_000_001),{attemptId:'a'},null])rejects(()=>recordCompletedQuiz(createLearningHistory(),quiz(),metadata),'INVALID_METADATA');
 const history=add(createLearningHistory(),quiz());const validated=validateLearningHistory(history);validated.records[0].questions[0].stem='changed';
 assert.notEqual(history.records[0].questions[0].stem,'changed');
});
