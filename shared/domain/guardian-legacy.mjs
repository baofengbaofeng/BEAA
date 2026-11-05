/** Frozen schema-1 reader. No constructors, writes, migration shortcuts or new commands. */
import { Phase,rollDay,validateDayKey } from './engine.mjs';
import { validateSession } from './snapshot.mjs';
import { validateLearningHistory } from './learning-history.mjs';
import { validateQuizProgress } from './quiz-progress.mjs';
import { validateRestProgress,getRestSession } from './rest-progress.mjs';

const QUIZ_KEYS=['schemaVersion','revision','attemptId','attempt','completion'];
class GuardianError extends Error {
  constructor(code,message){super(message);this.name='GuardianError';this.code=code;}
}
function check(ok,message,code='INVALID_LIFECYCLE'){if(!ok)throw new GuardianError(code,message);}
function fields(value,keys,code='INVALID_LIFECYCLE'){
  check(value!==null && typeof value==='object' && !Array.isArray(value),'Expected lifecycle object',code);
  check(keys.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>keys.includes(k)),'Missing or unknown lifecycle fields',code);
}
function id(v,max=128){return typeof v==='string' && v.length>0 && v.length<=max && v.trim()===v;}
function integer(v,max=Number.MAX_SAFE_INTEGER){return Number.isSafeInteger(v) && v>=0 && v<=max;}
function day(v){try{return validateDayKey(v);}catch{throw new GuardianError('INVALID_LIFECYCLE','Invalid lifecycle calendar date');}}
function trustedValidation(fn){try{return fn();}catch{throw new GuardianError('INVALID_LIFECYCLE','Inconsistent lifecycle component');}}
function action(fn){try{return fn();}catch(e){if(e instanceof GuardianError)throw e;throw new GuardianError(e.code??'INVALID_COMMAND','Lifecycle component rejected the command');}}
function sorted(v){return Array.isArray(v)?v.map(sorted):v!==null && typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;}
function same(a,b){return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));}
function clock(v){
  fields(v,['bootId','monotonicMs'],'INVALID_COMMAND');check(id(v.bootId) && integer(v.monotonicMs),'Invalid clock checkpoint','INVALID_COMMAND');
  return {bootId:v.bootId,monotonicMs:v.monotonicMs};
}
function normalizeCommand(v){
  const code='INVALID_COMMAND';fields(v,['lifecycleId','eventId','expectedRevision','type','payload'],code);
  check(id(v.lifecycleId,96) && id(v.eventId) && integer(v.expectedRevision),'Invalid lifecycle command identity',code);
  const p=v.payload;let payload;
  switch(v.type){
    case 'record_usage':
      fields(p,['seconds'],code);check(integer(p.seconds,86400),'Invalid verified usage seconds',code);payload={seconds:p.seconds};break;
    case 'begin_quiz':
      fields(p,['knowledgePoints'],code);
      check(Array.isArray(p.knowledgePoints) && Object.keys(p.knowledgePoints).length===p.knowledgePoints.length && p.knowledgePoints.length<=32 && Array.from(p.knowledgePoints).every(x=>id(x,80)) && new Set(p.knowledgePoints).size===p.knowledgePoints.length,'Invalid topic selection',code);
      payload={knowledgePoints:[...p.knowledgePoints]};break;
    case 'answer':
      fields(p,['questionId','chosen','completedAt','restAnchor'],code);
      check(id(p.questionId) && id(p.chosen,64) && (p.completedAt===null || integer(p.completedAt,8_640_000_000_000_000)),'Invalid answer submission',code);
      payload={questionId:p.questionId,chosen:p.chosen,completedAt:p.completedAt,restAnchor:p.restAnchor===null?null:clock(p.restAnchor)};break;
    case 'observe_rest':
      fields(p,['bootId','fromMs','toMs','condition'],code);
      check(id(p.bootId) && integer(p.fromMs) && integer(p.toMs) && p.toMs>=p.fromMs && p.toMs-p.fromMs<=86400000 && ['resting','active','unknown'].includes(p.condition),'Invalid verified rest interval',code);
      payload={bootId:p.bootId,fromMs:p.fromMs,toMs:p.toMs,condition:p.condition};break;
    case 'complete_rest':fields(p,['checkpoint'],code);payload={checkpoint:clock(p.checkpoint)};break;
    case 'roll_day':fields(p,['nextDay'],code);payload={nextDay:day(p.nextDay)};break;
    default:throw new GuardianError(code,'Unknown lifecycle command type');
  }
  return {lifecycleId:v.lifecycleId,eventId:v.eventId,expectedRevision:v.expectedRevision,type:v.type,payload};
}
function roundId(s){return `${s.lifecycleId}/round/${s.round}`;}
function packQuiz(progress){const {history,...packed}=progress;return packed;}
function unpackQuiz(p,history){fields(p,QUIZ_KEYS);return trustedValidation(()=>validateQuizProgress({...p,history}));}
function currentSession(s){
  let session=s.stage.kind==='session'?structuredClone(s.stage.session):s.stage.kind==='quiz'?structuredClone(s.stage.progress.attempt.session):getRestSession(s.stage.progress);
  if(session.dayKey<s.calendarDay)session=rollDay(session,s.calendarDay);
  return session;
}
function expectedFeedback(p){
  const index=p.revision-1,q=p.attempt.questions[index],a=p.attempt.session.challenge.answers[index];
  check(q && a,'Answer receipt lacks an answered question');
  return {questionId:q.id,correct:a.correct,correctOptionId:q.correctOptionId,explanation:q.explanation};
}
function validateReceipt(s,input){
  if(s.revision===0){
    check(input===null && s.round===0 && s.stage.kind==='session','Initial lifecycle has a receipt or round');
    check(s.stage.session.phase===Phase.AVAILABLE && s.stage.session.dailySeconds===0 && s.stage.session.cycleSeconds===0 && s.history.records.length===0,'Initial lifecycle contains unrecorded usage or history');return null;
  }
  fields(input,['command','feedback','restCompletion']);const c=normalizeCommand(input.command);
  check(c.lifecycleId===s.lifecycleId && c.expectedRevision===s.revision-1,'Receipt revision or lifecycle identity disagrees');
  let feedback=null,restCompletion=null;
  if(c.type==='answer'){
    check(s.stage.kind==='quiz' || s.stage.kind==='rest','Answer receipt lacks its quiz');
    const p=unpackQuiz(s.stage.kind==='quiz'?s.stage.progress:s.stage.quiz,s.history),last=p.attempt.session.challenge.answers.at(-1);
    feedback=expectedFeedback(p);fields(input.feedback,Object.keys(feedback));
    check(same(input.feedback,feedback) && last.questionId===c.payload.questionId && last.chosen===c.payload.chosen,'Answer receipt disagrees with the pinned quiz');
    const final=p.completion!==null;
    check(final?c.payload.completedAt===p.completion.completedAt && c.payload.restAnchor!==null:c.payload.completedAt===null && c.payload.restAnchor===null,'Answer receipt has an unrelated completion');
    if(s.stage.kind==='rest')check(s.stage.progress.revision===0 && s.stage.progress.bootId===c.payload.restAnchor.bootId && s.stage.progress.cursorMs===c.payload.restAnchor.monotonicMs,'Answer receipt disagrees with initial rest anchor');
  }else{
    check(input.feedback===null,'Non-answer receipt contains answer feedback');
    if(c.type==='begin_quiz')check(s.stage.kind==='quiz' && s.stage.progress.revision===0,'Begin receipt lacks its unanswered quiz');
    if(c.type==='record_usage')check(s.stage.kind==='session','Usage receipt has an unrelated stage');
    if(c.type==='roll_day')check(c.payload.nextDay===s.calendarDay,'Calendar receipt disagrees with current day');
    if(c.type==='observe_rest'){
      check(s.stage.kind==='rest' && s.stage.progress.lastInterval!==null,'Interval receipt lacks its rest event');
      const event=s.stage.progress.lastInterval.command;
      check(same(c.payload,{bootId:event.bootId,fromMs:event.fromMs,toMs:event.toMs,condition:event.condition}),'Rest receipt disagrees with its interval');
    }
    if(c.type==='complete_rest'){
      fields(input.restCompletion,['progress','quiz']);
      const progress=trustedValidation(()=>validateRestProgress(input.restCompletion.progress)),quiz=unpackQuiz(input.restCompletion.quiz,s.history);
      check(s.stage.kind==='session' && quiz.attemptId===roundId(s) && progress.restId===quiz.attemptId && progress.completion!==null && same(progress.completion,c.payload.checkpoint) && same(progress.sourceSession,quiz.attempt.session),'Completion receipt lacks its matching rest proof');
      restCompletion={progress,quiz:packQuiz(quiz)};
      let derived=getRestSession(progress);if(derived.dayKey<s.calendarDay)derived=rollDay(derived,s.calendarDay);
      check(same(derived,s.stage.session),'Completed rest and stored usage session disagree');
    }
  }
  if(c.type!=='complete_rest')check(input.restCompletion===null,'Unrelated receipt contains a rest completion');
  return {command:c,feedback,restCompletion};
}

export function validateLegacyLifecycle(input){
  fields(input,['schemaVersion','lifecycleId','revision','round','calendarDay','history','stage','lastReceipt']);
  check(input.schemaVersion===1,'Unsupported lifecycle snapshot version','UNSUPPORTED_VERSION');
  check(id(input.lifecycleId,96) && integer(input.revision) && integer(input.round) && input.round<=input.revision,'Invalid lifecycle identity or counters');day(input.calendarDay);
  const history=trustedValidation(()=>validateLearningHistory(input.history));let stage;
  const source=input.stage;check(source!==null && typeof source==='object','Missing lifecycle stage');
  if(source.kind==='session'){
    fields(source,['kind','session']);const session=trustedValidation(()=>validateSession(source.session));
    check([Phase.AVAILABLE,Phase.CHALLENGE_REQUIRED,Phase.DAILY_LOCKED].includes(session.phase) && session.challenge===null && session.dayKey===input.calendarDay,'Ordinary stage retains an unrelated challenge or day');
    stage={kind:'session',session};
  }else if(source.kind==='quiz' || source.kind==='rest'){
    check(input.round>0,'Quiz/rest stage lacks a round identity');
    fields(source,source.kind==='quiz'?['kind','progress']:['kind','quiz','progress']);
    const quiz=unpackQuiz(source.kind==='quiz'?source.progress:source.quiz,history),session=quiz.attempt.session;
    check(quiz.attemptId===roundId(input) && session.dayKey<=input.calendarDay,'Quiz round identity or calendar disagrees');
    if(source.kind==='quiz'){
      check([Phase.CHALLENGE_ACTIVE,Phase.CHALLENGE_REQUIRED].includes(session.phase),'Quiz stage has a passing rest grant');
      if(session.phase===Phase.CHALLENGE_ACTIVE)check(session.dayKey===input.calendarDay,'Active quiz has an old calendar day');
      stage={kind:'quiz',progress:packQuiz(quiz)};
    }else{
      const progress=trustedValidation(()=>validateRestProgress(source.progress));
      check(session.phase===Phase.REST_REQUIRED && progress.restId===quiz.attemptId && progress.completion===null && same(progress.sourceSession,session),'Rest source disagrees with the passing quiz');
      stage={kind:'rest',quiz:packQuiz(quiz),progress};
    }
  }else throw new GuardianError('INVALID_LIFECYCLE','Unknown lifecycle stage');
  const s={schemaVersion:1,lifecycleId:input.lifecycleId,revision:input.revision,round:input.round,calendarDay:input.calendarDay,history,stage,lastReceipt:null};
  s.lastReceipt=validateReceipt(s,input.lastReceipt);return s;
}
export function getLegacySession(input){return currentSession(validateLegacyLifecycle(input));}
