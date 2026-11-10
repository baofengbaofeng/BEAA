import { validateDayKey } from './engine.mjs';
import { validateQuizAttempt } from './quiz-service.mjs';
import { validateQuestionBank,evaluateQuestionResponse,questionBankVersion } from '../quiz/bank.mjs';

const SUBJECTS=['chinese','math','english'];
const SNAPSHOT_LIMIT=5_000_000;
export class LearningHistoryError extends Error {
  constructor(code,message){super(message);this.name='LearningHistoryError';this.code=code;}
}
function check(condition,message,code='INVALID_HISTORY'){
  if(!condition)throw new LearningHistoryError(code,message);
}
function fields(value,allowed,required=allowed,code='INVALID_HISTORY'){
  check(value!==null && typeof value==='object' && !Array.isArray(value),'Expected learning data object',code);
  check(required.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>allowed.includes(k)),'Missing or unknown learning data fields',code);
}
function dense(array){return Array.isArray(array) && Object.keys(array).length===array.length && Array.from(array).every(item=>item!==undefined);}
function identifier(value,max=128){return typeof value==='string' && value.length>0 && value.length<=max && value.trim()===value;}
function validDay(day,code='INVALID_HISTORY'){
  try{validateDayKey(day);}catch{throw new LearningHistoryError(code,'Invalid learning date');}
}
function compare(a,b){return a.completedAt-b.completedAt || (a.id<b.id?-1:a.id>b.id?1:0);}
function validLimit(limit){check(Number.isInteger(limit) && limit>=1 && limit<=200,'Invalid history retention limit');}
function timestamp(value){return Number.isSafeInteger(value) && value>=0 && value<=8_640_000_000_000_000;}
function canonicalQuestion(q){
  return {id:q.id,grade:q.grade,subject:q.subject,type:q.type,stem:q.stem,...(q.options?{options:q.options.map(o=>({id:o.id,text:o.text})),correctOptionId:q.correctOptionId}:{correctAnswer:q.correctAnswer,...(q.absoluteTolerance!==undefined?{absoluteTolerance:q.absoluteTolerance}:{})}),explanation:q.explanation,knowledgePoints:[...q.knowledgePoints]};
}
function validateRecord(record){
  fields(record,['id','completedAt','dayKey','requiredCorrect','questions','answers']);
  check(identifier(record.id) && timestamp(record.completedAt),'Invalid completion event metadata');
  validDay(record.dayKey);
  check(dense(record.questions) && record.questions.length>=1 && record.questions.length<=20,'Invalid recorded quiz size');
  // Unlike bank imports, persisted records must include every canonical field.
  check(record.questions.every(q=>q!==null && typeof q==='object' && Object.hasOwn(q,'knowledgePoints')),'Missing recorded knowledge points');
  let questions;
  try{questions=validateQuestionBank({version:questionBankVersion(record.questions),questions:record.questions}).questions.map(canonicalQuestion);}
  catch{throw new LearningHistoryError('INVALID_HISTORY','Invalid recorded question snapshot');}
  check(questions.every(q=>q.grade===questions[0].grade),'Mixed grades in recorded quiz');
  check(Number.isInteger(record.requiredCorrect) && record.requiredCorrect>=1 && record.requiredCorrect<=questions.length,'Invalid recorded pass threshold');
  check(dense(record.answers) && record.answers.length===questions.length,'Incomplete recorded quiz');
  const answers=record.answers.map((a,i)=>{
    fields(a,['questionId','chosen']);
    check(a.questionId===questions[i].id && evaluateQuestionResponse(questions[i],a.chosen).valid && evaluateQuestionResponse(questions[i],a.chosen).value===a.chosen,'Recorded answer does not match its question');
    return {questionId:a.questionId,chosen:a.chosen};
  });
  return {id:record.id,completedAt:record.completedAt,dayKey:record.dayKey,requiredCorrect:record.requiredCorrect,questions,answers};
}
export function createLearningHistory(limit=200){
  validLimit(limit);return {schemaVersion:1,limit,records:[]};
}
/** Educational records never authorize usage. Invalid data must be handled explicitly by the caller. */
export function validateLearningHistory(input){
  fields(input,['schemaVersion','limit','records']);
  check(input.schemaVersion===1,'Unsupported history version','UNSUPPORTED_VERSION');validLimit(input.limit);
  check(dense(input.records) && input.records.length<=input.limit,'Invalid history length');
  const records=input.records.map(validateRecord),seen=new Set();
  for(const [i,r] of records.entries()){
    check(!seen.has(r.id) && (!i || compare(records[i-1],r)<0),'Duplicate or unordered completion events');seen.add(r.id);
  }
  return {schemaVersion:1,limit:input.limit,records};
}
/** Metadata must come from a stable, trusted completion event, before a later day rollover. */
export function recordCompletedQuiz(input,attemptInput,metadata){
  const history=validateLearningHistory(input);
  fields(metadata,['attemptId','completedAt'],undefined,'INVALID_METADATA');
  check(identifier(metadata.attemptId) && timestamp(metadata.completedAt),'Invalid completion event metadata','INVALID_METADATA');
  let attempt;
  try{attempt=validateQuizAttempt(attemptInput);}catch{throw new LearningHistoryError('INVALID_HISTORY','Invalid completed quiz attempt');}
  const {session,questions}=attempt;
  check(session.challenge.answers.length===questions.length,'Only completed quizzes may be recorded');
  const record=validateRecord({id:metadata.attemptId,completedAt:metadata.completedAt,dayKey:session.dayKey,
    requiredCorrect:session.policy.requiredCorrect,questions,
    answers:session.challenge.answers.map(a=>({questionId:a.questionId,chosen:a.chosen}))});
  const existing=history.records.find(r=>r.id===record.id);
  if(existing){
    check(JSON.stringify(existing)===JSON.stringify(record),'Completion event ID conflicts with retained data','CONFLICT');
    return {history,outcome:'duplicate'};
  }
  const records=[...history.records,record].sort(compare).slice(-history.limit);
  if(!records.some(r=>r.id===record.id))return {history,outcome:'outside_window'};
  return {history:{...history,records},outcome:'added'};
}
function queryRecords(input,query,wrongQuery=false){
  const history=validateLearningHistory(input),keys=wrongQuery?['dayKey','grade','subject','knowledgePoint']:['dayKey','grade'];
  fields(query,keys,[],'INVALID_QUERY');
  if(Object.hasOwn(query,'dayKey'))validDay(query.dayKey,'INVALID_QUERY');
  if(Object.hasOwn(query,'grade'))check(Number.isInteger(query.grade) && query.grade>=1 && query.grade<=6,'Invalid grade filter','INVALID_QUERY');
  if(Object.hasOwn(query,'subject'))check(SUBJECTS.includes(query.subject),'Invalid subject filter','INVALID_QUERY');
  if(Object.hasOwn(query,'knowledgePoint'))check(identifier(query.knowledgePoint,80),'Invalid knowledge-point filter','INVALID_QUERY');
  return history.records.filter(r=>(!Object.hasOwn(query,'dayKey') || r.dayKey===query.dayKey) && (!Object.hasOwn(query,'grade') || r.questions[0].grade===query.grade)).reverse();
}
function correct(record,index){return evaluateQuestionResponse(record.questions[index],record.answers[index].chosen).correct;}
export function listLearningRecords(input,query={}){
  return queryRecords(input,query).map(r=>{
    const correctCount=r.answers.filter((_,i)=>correct(r,i)).length;
    return {id:r.id,completedAt:r.completedAt,dayKey:r.dayKey,grade:r.questions[0].grade,
      questionCount:r.questions.length,correctCount,requiredCorrect:r.requiredCorrect,passed:correctCount>=r.requiredCorrect};
  });
}
/** Each wrong occurrence is retained separately, including its historic answer key and explanation. */
export function getWrongAnswers(input,query={}){
  const records=queryRecords(input,query,true),result=[];
  for(const r of records)for(const [i,q] of r.questions.entries()){
    if(correct(r,i) || (Object.hasOwn(query,'subject') && q.subject!==query.subject) ||
      (Object.hasOwn(query,'knowledgePoint') && !q.knowledgePoints.includes(query.knowledgePoint)))continue;
    const {correctOptionId,correctAnswer,explanation,...question}=q;
    result.push({attemptId:r.id,completedAt:r.completedAt,dayKey:r.dayKey,question,chosen:r.answers[i].chosen,...(q.options?{correctOptionId}:{correctAnswer}),explanation});
  }
  return result;
}
function counters(){return {answerCount:0,correctCount:0};}
function increment(counter,isCorrect){counter.answerCount++;if(isCorrect)counter.correctCount++;}
function withAccuracy(counter){return {...counter,accuracy:counter.answerCount?Math.round(100*counter.correctCount/counter.answerCount):null};}
export function getLearningStats(input,query={}){
  const records=queryRecords(input,query),total=counters(),bySubject=Object.fromEntries(SUBJECTS.map(s=>[s,counters()])),points=new Map();let passedQuizCount=0;
  for(const r of records){
    let quizCorrect=0;
    for(const [i,q] of r.questions.entries()){
      const isCorrect=correct(r,i);if(isCorrect)quizCorrect++;
      increment(total,isCorrect);increment(bySubject[q.subject],isCorrect);
      for(const point of q.knowledgePoints){if(!points.has(point))points.set(point,counters());increment(points.get(point),isCorrect);}
    }
    if(quizCorrect>=r.requiredCorrect)passedQuizCount++;
  }
  return {quizCount:records.length,passedQuizCount,...withAccuracy(total),
    bySubject:Object.fromEntries(SUBJECTS.map(s=>[s,withAccuracy(bySubject[s])])),
    byKnowledgePoint:[...points.keys()].sort().map(knowledgePoint=>({knowledgePoint,...withAccuracy(points.get(knowledgePoint))}))};
}
function revisionValid(revision){check(Number.isSafeInteger(revision) && revision>=0,'Invalid history revision');}
export function encodeLearningHistory(input,revision=0){
  const history=validateLearningHistory(input);revisionValid(revision);
  const text=JSON.stringify({schemaVersion:1,revision,history});
  check(text.length<=SNAPSHOT_LIMIT,'History snapshot is too large','SNAPSHOT_TOO_LARGE');return text;
}
export function decodeLearningHistory(text){
  check(typeof text==='string','Expected serialized learning history');
  check(text.length<=SNAPSHOT_LIMIT,'History snapshot is too large','SNAPSHOT_TOO_LARGE');
  let value;try{value=JSON.parse(text);}catch{throw new LearningHistoryError('INVALID_HISTORY','Malformed history JSON');}
  fields(value,['schemaVersion','revision','history']);
  check(value.schemaVersion===1,'Unsupported history snapshot version','UNSUPPORTED_VERSION');revisionValid(value.revision);
  return {revision:value.revision,history:validateLearningHistory(value.history)};
}
