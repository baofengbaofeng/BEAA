import {evaluateQuestionResponse} from '../quiz/bank.mjs';
import { Phase } from './engine.mjs';
import { validateQuizAttempt,submitQuizAnswer } from './quiz-service.mjs';
import { createLearningHistory,validateLearningHistory,recordCompletedQuiz } from './learning-history.mjs';

const LIMIT=6_000_000;
export class QuizProgressError extends Error {
  constructor(code,message){super(message);this.name='QuizProgressError';this.code=code;}
}
function check(condition,message,code='INVALID_PROGRESS'){
  if(!condition)throw new QuizProgressError(code,message);
}
function fields(value,keys,code='INVALID_PROGRESS'){
  check(value!==null && typeof value==='object' && !Array.isArray(value),'Expected progress object',code);
  check(keys.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>keys.includes(k)),'Missing or unknown progress fields',code);
}
function id(value,max=128){return typeof value==='string' && value.length>0 && value.length<=max && value.trim()===value;}
function timestamp(value){return Number.isSafeInteger(value) && value>=0 && value<=8_640_000_000_000_000;}
function validatedAttempt(input){
  try{
    // Persisted snapshots cannot use the bank importer's omitted-tag default.
    check(Array.isArray(input.questions) && input.questions.every(q=>q!==null && typeof q==='object' && Object.hasOwn(q,'knowledgePoints')),'Missing pinned knowledge points');
    return validateQuizAttempt(input);
  }catch{throw new QuizProgressError('INVALID_PROGRESS','Invalid progress quiz snapshot');}
}
function validatedHistory(input){
  try{return validateLearningHistory(input);}catch{throw new QuizProgressError('INVALID_PROGRESS','Invalid progress learning history');}
}

/** Single-round aggregate. Only a trusted controller may allocate its non-reusable ID. */
export function createQuizProgress(attemptId,attemptInput,historyInput=createLearningHistory()){
  const attempt=validatedAttempt(attemptInput);
  check(attempt.session.phase===Phase.CHALLENGE_ACTIVE && attempt.session.challenge.answers.length===0,'Progress must begin with an unanswered active quiz');
  return validateQuizProgress({schemaVersion:1,revision:0,attemptId,attempt,history:historyInput,completion:null});
}

/** Validate all three associations: answer prefix/revision, completion event, retained archive. */
export function validateQuizProgress(input){
  fields(input,['schemaVersion','revision','attemptId','attempt','history','completion']);
  check(input.schemaVersion===1,'Unsupported progress snapshot version','UNSUPPORTED_VERSION');
  check(id(input.attemptId),'Invalid progress attempt ID');
  const attempt=validatedAttempt(input.attempt),history=validatedHistory(input.history);
  const answered=attempt.session.challenge.answers.length,complete=answered===attempt.questions.length;
  check(Number.isSafeInteger(input.revision) && input.revision===answered,'Progress revision disagrees with answers');
  let completion=null;
  if(!complete){
    check(attempt.session.phase===Phase.CHALLENGE_ACTIVE && input.completion===null,'Incomplete progress has a completion');
    check(!history.records.some(r=>r.id===input.attemptId),'Attempt ID already exists in history');
  }else{
    const passed=attempt.session.challenge.answers.filter(a=>a.correct).length>=attempt.session.policy.requiredCorrect;
    check(attempt.session.phase===(passed?Phase.REST_REQUIRED:Phase.CHALLENGE_REQUIRED),'Completed progress has an unrelated session phase');
    fields(input.completion,['completedAt','archiveOutcome']);
    check(timestamp(input.completion.completedAt) && ['added','outside_window'].includes(input.completion.archiveOutcome),'Invalid progress completion');
    let archival;
    try{archival=recordCompletedQuiz(history,attempt,{attemptId:input.attemptId,completedAt:input.completion.completedAt});}
    catch{throw new QuizProgressError('INVALID_PROGRESS','Completion disagrees with learning history');}
    const expected=input.completion.archiveOutcome==='added'?'duplicate':'outside_window';
    check(archival.outcome===expected,'Completed progress lacks its matching archive outcome');
    completion={completedAt:input.completion.completedAt,archiveOutcome:input.completion.archiveOutcome};
  }
  return {schemaVersion:1,revision:input.revision,attemptId:input.attemptId,attempt,history,completion};
}
function feedback(progress,index){
  const q=progress.attempt.questions[index],answer=progress.attempt.session.challenge.answers[index];
  return {questionId:q.id,correct:answer.correct,...(q.options?{correctOptionId:q.correctOptionId}:{correctAnswer:q.correctAnswer}),explanation:q.explanation};
}

/** Compute both answer and archive before storage; this pure function does not commit anything. */
export function submitProgressAnswer(input,command){
  const progress=validateQuizProgress(input);
  fields(command,['attemptId','expectedRevision','questionId','chosen','completedAt'],'INVALID_COMMAND');
  check(id(command.attemptId) && Number.isSafeInteger(command.expectedRevision) && command.expectedRevision>=0 &&
    id(command.questionId) && typeof command.chosen==='string' && command.chosen.length<=64,'Invalid answer command','INVALID_COMMAND');
  check(command.attemptId===progress.attemptId,'Answer belongs to another quiz round','CONFLICT');
  check(command.expectedRevision<=progress.revision,'Answer is ahead of stored progress','CONFLICT');
  const index=command.expectedRevision,q=progress.attempt.questions[index];
  check(q && command.questionId===q.id && evaluateQuestionResponse(q,command.chosen).valid,'Answer does not identify an offered question/option','INVALID_COMMAND');
  command={...command,chosen:evaluateQuestionResponse(q,command.chosen).value};
  const final=index===progress.attempt.questions.length-1;
  check(final?timestamp(command.completedAt):command.completedAt===null,'Invalid completion timestamp','INVALID_COMMAND');
  if(index<progress.revision){
    check(progress.attempt.session.challenge.answers[index].chosen===command.chosen &&
      (!final || progress.completion.completedAt===command.completedAt),'Answer command conflicts with committed data','CONFLICT');
    return {progress,duplicate:true,feedback:feedback(progress,index)};
  }
  const submitted=submitQuizAnswer(progress.attempt,{questionId:command.questionId,chosen:command.chosen});
  let history=progress.history,completion=null;
  if(final){
    const recorded=recordCompletedQuiz(history,submitted.attempt,{attemptId:progress.attemptId,completedAt:command.completedAt});
    history=recorded.history;completion={completedAt:command.completedAt,archiveOutcome:recorded.outcome};
  }
  const next=validateQuizProgress({...progress,revision:progress.revision+1,attempt:submitted.attempt,history,completion});
  return {progress:next,duplicate:false,feedback:submitted.feedback};
}
export function encodeQuizProgress(input){
  const text=JSON.stringify(validateQuizProgress(input));
  check(text.length<=LIMIT,'Progress snapshot is too large','SNAPSHOT_TOO_LARGE');return text;
}
export function decodeQuizProgress(text){
  check(typeof text==='string','Expected serialized progress');
  check(text.length<=LIMIT,'Progress snapshot is too large','SNAPSHOT_TOO_LARGE');
  let value;try{value=JSON.parse(text);}catch{throw new QuizProgressError('INVALID_PROGRESS','Malformed progress JSON');}
  return validateQuizProgress(value);
}
