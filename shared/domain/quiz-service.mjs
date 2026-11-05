import { Phase,startChallenge,submitAnswer } from './engine.mjs';
import { validateSession,encodeSession,decodeSession } from './snapshot.mjs';
import { QuizError,validateQuestionBank,selectQuestions } from '../quiz/bank.mjs';

const LIMIT=1_000_000;
function check(value,message,code='INVALID_ATTEMPT'){if(!value)throw new QuizError(code,message);}
function fields(value,keys,code='INVALID_ATTEMPT'){
  check(value!==null && typeof value==='object' && !Array.isArray(value),'Expected quiz attempt object',code);
  check(keys.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>keys.includes(key)),'Missing or unknown quiz attempt fields',code);
}
function sessionState(input){try{return validateSession(input);}catch{throw new QuizError('INVALID_ATTEMPT','Invalid quiz session state');}}

/** Attempts include private answer snapshots and belong to the trusted controller/store. */
export function validateQuizAttempt(input){
  fields(input,['session','questions']);const session=sessionState(input.session);let questions;
  try{questions=validateQuestionBank({version:1,questions:input.questions}).questions;}catch{throw new QuizError('INVALID_ATTEMPT','Invalid pinned question snapshot');}
  check(session.challenge!==null && questions.length===session.policy.questionCount,'Quiz attempt has no matching challenge');
  for(const [index,q] of questions.entries()){
    check(q.id===session.challenge.questionIds[index] && q.grade===session.policy.grade && session.policy.subjects.includes(q.subject),'Pinned questions disagree with the session');
    const answer=session.challenge.answers[index];
    if(answer)check(q.options.some(o=>o.id===answer.chosen) && answer.correct===(answer.chosen===q.correctOptionId),'Stored grade disagrees with the pinned answer key');
  }
  return {session,questions};
}

export function startQuiz(session,bank,options={}){
  const state=sessionState(session);check(state.phase===Phase.CHALLENGE_REQUIRED,'Quiz is not required');
  const questions=selectQuestions(bank,state.policy,options);
  return validateQuizAttempt({session:startChallenge(state,questions.map(q=>q.id)),questions});
}
function publicQuestion(q){
  return structuredClone({id:q.id,grade:q.grade,subject:q.subject,type:q.type,stem:q.stem,options:q.options,knowledgePoints:q.knowledgePoints});
}
export function getCurrentQuestion(input){
  const attempt=validateQuizAttempt(input);
  if(attempt.session.phase!==Phase.CHALLENGE_ACTIVE)return null;
  return publicQuestion(attempt.questions[attempt.session.challenge.answers.length]);
}

export function getQuizReview(input){
  const attempt=validateQuizAttempt(input);
  return attempt.session.challenge.answers.map((answer,index)=>({question:publicQuestion(attempt.questions[index]),chosen:answer.chosen,correct:answer.correct,
    correctOptionId:attempt.questions[index].correctOptionId,explanation:attempt.questions[index].explanation}));
}

/** The submission contains only the chosen option, never a claimed grade or answer key. */
export function submitQuizAnswer(input,submission){
  const attempt=validateQuizAttempt(input);fields(submission,['questionId','chosen'],'INVALID_ANSWER');
  check(attempt.session.phase===Phase.CHALLENGE_ACTIVE,'Quiz is not active');
  const q=attempt.questions[attempt.session.challenge.answers.length];
  check(submission.questionId===q.id && typeof submission.chosen==='string' && q.options.some(o=>o.id===submission.chosen),'Unknown, stale or unoffered answer','INVALID_ANSWER');
  const session=submitAnswer(attempt.session,q.id,submission.chosen,q.correctOptionId);
  return {attempt:{session,questions:attempt.questions},feedback:{questionId:q.id,correct:submission.chosen===q.correctOptionId,correctOptionId:q.correctOptionId,explanation:q.explanation}};
}

/** Revision/authentication/atomic commit remain the persistence adapter's responsibility. */
export function encodeQuizAttempt(input,revision=0){
  const attempt=validateQuizAttempt(input);let domain;
  try{domain=JSON.parse(encodeSession(attempt.session,revision));}catch{throw new QuizError('INVALID_ATTEMPT','Invalid quiz snapshot revision or session');}
  const text=JSON.stringify({schemaVersion:1,domain,quizSnapshot:{version:1,questions:attempt.questions}});
  check(text.length<=LIMIT,'Quiz snapshot is too large','SNAPSHOT_TOO_LARGE');return text;
}
export function decodeQuizAttempt(text){
  check(typeof text==='string','Expected serialized quiz attempt');check(text.length<=LIMIT,'Quiz snapshot is too large','SNAPSHOT_TOO_LARGE');
  let value;try{value=JSON.parse(text);}catch{throw new QuizError('INVALID_ATTEMPT','Malformed quiz snapshot JSON');}
  fields(value,['schemaVersion','domain','quizSnapshot']);check(value.schemaVersion===1,'Unsupported quiz snapshot version','UNSUPPORTED_VERSION');
  let domain;try{domain=decodeSession(JSON.stringify(value.domain));}catch(error){throw new QuizError(error.code==='UNSUPPORTED_VERSION'?'UNSUPPORTED_VERSION':'INVALID_ATTEMPT','Invalid domain snapshot in quiz attempt');}
  let bank;try{bank=validateQuestionBank(value.quizSnapshot);}catch{throw new QuizError('INVALID_ATTEMPT','Invalid pinned quiz snapshot');}
  return {revision:domain.revision,attempt:validateQuizAttempt({session:domain.session,questions:bank.questions})};
}
