import {evaluateQuestionResponse} from '../quiz/bank.mjs';
import { validateLegacyLifecycle,getLegacySession } from './guardian-legacy.mjs';
import { Phase,createSession,recordUsage,rollDay,validateDayKey } from './engine.mjs';
import { validateSession } from './snapshot.mjs';
import { startQuiz,getCurrentQuestion } from './quiz-service.mjs';
import { createLearningHistory,validateLearningHistory } from './learning-history.mjs';
import { createQuizProgress,validateQuizProgress,submitProgressAnswer } from './quiz-progress.mjs';
import { createRestProgress,validateRestProgress,observeRestInterval,getRestSession,getRestStatus,completeVerifiedRest } from './rest-progress.mjs';

const LIMIT=8_000_000;
const QUIZ_KEYS=['schemaVersion','revision','attemptId','attempt','completion'];
export class GuardianError extends Error {
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
    case 'set_policy':fields(p,['policy'],code);payload={policy:policyValue(p.policy)};break;
    default:throw new GuardianError(code,'Unknown lifecycle command type');
  }
  return {lifecycleId:v.lifecycleId,eventId:v.eventId,expectedRevision:v.expectedRevision,type:v.type,payload};
}
function roundId(s){return `${s.lifecycleId}/round/${s.round}`;}
function packQuiz(progress){const {history,...packed}=progress;return packed;}
function unpackQuiz(p,history){fields(p,QUIZ_KEYS);return trustedValidation(()=>validateQuizProgress({...p,history}));}
function sourceSession(s){
  let session=s.stage.kind==='session'?structuredClone(s.stage.session):s.stage.kind==='quiz'?structuredClone(s.stage.progress.attempt.session):getRestSession(s.stage.progress);
  if(session.dayKey<s.calendarDay)session=rollDay(session,s.calendarDay);
  return session;
}
function policyValue(input){return trustedValidation(()=>validateSession(createSession(input,'2000-01-01')).policy);}
function ordinarySession(source,policy,actual,calendarDay){
  const cap=policy.dailyLimitMinutes*60;
  return trustedValidation(()=>validateSession({...source,policy:structuredClone(policy),dayKey:calendarDay,dailySeconds:Math.min(actual,cap),
    phase:actual>=cap?Phase.DAILY_LOCKED:source.cycleSeconds>=policy.periodMinutes*60?Phase.CHALLENGE_REQUIRED:Phase.AVAILABLE,
    challenge:null,pendingGrant:false}));
}
function currentSession(s){
  const source=sourceSession(s);
  return s.stage.kind==='quiz' && s.stage.progress.completion!==null?ordinarySession(source,s.policy,s.dailyUsageSeconds,s.calendarDay):source;
}
function unsafePolicyBoundary(stage){return stage.kind==='rest' || stage.kind==='quiz' && stage.progress.completion===null;}
function migrateLegacy(input){
  const legacy=trustedValidation(()=>validateLegacyLifecycle(input)),session=trustedValidation(()=>getLegacySession(legacy));
  return {...legacy,schemaVersion:2,policy:structuredClone(session.policy),dailyUsageSeconds:session.dailySeconds,pendingPolicy:null};
}
function advanceCounter(n){check(n<Number.MAX_SAFE_INTEGER,'Lifecycle counter exhausted','COUNTER_EXHAUSTED');return n+1;}
function expectedFeedback(p){
  const index=p.revision-1,q=p.attempt.questions[index],a=p.attempt.session.challenge.answers[index];
  check(q && a,'Answer receipt lacks an answered question');
  return {questionId:q.id,correct:a.correct,...(q.options?{correctOptionId:q.correctOptionId}:{correctAnswer:q.correctAnswer}),explanation:q.explanation};
}
function validateReceipt(s,input){
  if(s.revision===0){
    check(input===null && s.round===0 && s.stage.kind==='session','Initial lifecycle has a receipt or round');
    check(s.stage.session.phase===Phase.AVAILABLE && s.stage.session.dailySeconds===0 && s.stage.session.cycleSeconds===0 && s.history.records.length===0 && s.dailyUsageSeconds===0 && s.pendingPolicy===null,'Initial lifecycle contains unrecorded usage or history');return null;
  }
  fields(input,['command','feedback','restCompletion']);const c=normalizeCommand(input.command);
  check(c.lifecycleId===s.lifecycleId && c.expectedRevision===s.revision-1,'Receipt revision or lifecycle identity disagrees');
  let feedback=null,restCompletion=null;
  if(c.type==='answer'){
    check(s.stage.kind==='quiz' || s.stage.kind==='rest','Answer receipt lacks its quiz');
    const p=unpackQuiz(s.stage.kind==='quiz'?s.stage.progress:s.stage.quiz,s.history),last=p.attempt.session.challenge.answers.at(-1);
    feedback=expectedFeedback(p);fields(input.feedback,Object.keys(feedback));
    check(same(input.feedback,feedback) && last.questionId===c.payload.questionId && last.chosen===evaluateQuestionResponse(p.attempt.questions[p.revision-1],c.payload.chosen).value,'Answer receipt disagrees with the pinned quiz');
    const final=p.completion!==null;
    check(final?c.payload.completedAt===p.completion.completedAt && c.payload.restAnchor!==null:c.payload.completedAt===null && c.payload.restAnchor===null,'Answer receipt has an unrelated completion');
    if(s.stage.kind==='rest')check(s.stage.progress.revision===0 && s.stage.progress.bootId===c.payload.restAnchor.bootId && s.stage.progress.cursorMs===c.payload.restAnchor.monotonicMs,'Answer receipt disagrees with initial rest anchor');
  }else{
    check(input.feedback===null,'Non-answer receipt contains answer feedback');
    if(c.type==='begin_quiz')check(s.stage.kind==='quiz' && s.stage.progress.revision===0,'Begin receipt lacks its unanswered quiz');
    if(c.type==='set_policy')check(same(c.payload.policy,s.pendingPolicy??s.policy),'Policy receipt disagrees with active/pending settings');
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
      check(s.dailyUsageSeconds===(progress.sourceSession.dayKey<s.calendarDay?0:progress.sourceSession.dailySeconds),'Completed rest lost actual daily usage');
      const derived=ordinarySession(getRestSession(progress),s.policy,s.dailyUsageSeconds,s.calendarDay);
      check(same(derived,s.stage.session),'Completed rest and stored usage session disagree');
    }
  }
  if(c.type!=='complete_rest')check(input.restCompletion===null,'Unrelated receipt contains a rest completion');
  return {command:c,feedback,restCompletion};
}

/** Only for an initial ledger, never a fallback for failed restoration. */
export function createGuardianLifecycle(lifecycleId,policy,dayKey){
  return validateGuardianLifecycle({schemaVersion:2,lifecycleId,revision:0,round:0,calendarDay:dayKey,policy:policyValue(policy),dailyUsageSeconds:0,pendingPolicy:null,
    history:createLearningHistory(),stage:{kind:'session',session:trustedValidation(()=>createSession(policy,dayKey))},lastReceipt:null});
}
export function validateGuardianLifecycle(input){
  check(input!==null && typeof input==='object' && !Array.isArray(input) && Object.hasOwn(input,'schemaVersion'),'Missing lifecycle schema version');
  if(input?.schemaVersion===1)input=migrateLegacy(input);
  check(input?.schemaVersion===2,'Unsupported lifecycle snapshot version','UNSUPPORTED_VERSION');
  fields(input,['schemaVersion','lifecycleId','revision','round','calendarDay','history','stage','lastReceipt','policy','dailyUsageSeconds','pendingPolicy']);
  const policy=policyValue(input.policy),pendingPolicy=input.pendingPolicy===null?null:policyValue(input.pendingPolicy);
  check(integer(input.dailyUsageSeconds,36000),'Invalid actual daily usage');
  check(id(input.lifecycleId,96) && integer(input.revision) && integer(input.round) && input.round<=input.revision,'Invalid lifecycle identity or counters');day(input.calendarDay);
  const history=trustedValidation(()=>validateLearningHistory(input.history));let stage;
  const source=input.stage;check(source!==null && typeof source==='object','Missing lifecycle stage');
  if(source.kind==='session'){
    fields(source,['kind','session']);const session=trustedValidation(()=>validateSession(source.session));
    check([Phase.AVAILABLE,Phase.CHALLENGE_REQUIRED,Phase.DAILY_LOCKED].includes(session.phase) && session.challenge===null && session.dayKey===input.calendarDay,'Ordinary stage retains an unrelated challenge or day');
    check(same(session.policy,policy) && session.dailySeconds===Math.min(input.dailyUsageSeconds,policy.dailyLimitMinutes*60) && (input.dailyUsageSeconds>=policy.dailyLimitMinutes*60)===(session.phase===Phase.DAILY_LOCKED),'Policy projection or actual usage disagrees');
    stage={kind:'session',session};
  }else if(source.kind==='quiz' || source.kind==='rest'){
    check(input.round>0,'Quiz/rest stage lacks a round identity');
    fields(source,source.kind==='quiz'?['kind','progress']:['kind','quiz','progress']);
    const quiz=unpackQuiz(source.kind==='quiz'?source.progress:source.quiz,history),session=quiz.attempt.session;
    check(quiz.attemptId===roundId(input) && session.dayKey<=input.calendarDay,'Quiz round identity or calendar disagrees');
    check(input.dailyUsageSeconds===(session.dayKey<input.calendarDay?0:session.dailySeconds),'Pinned challenge and actual usage disagree');
    if(source.kind==='rest' || quiz.completion===null)check(same(session.policy,policy),'An in-progress round changed its pinned policy');
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
  if(pendingPolicy!==null)check(unsafePolicyBoundary(stage) && !same(policy,pendingPolicy),'Pending policy has no active round boundary');
  const s={schemaVersion:2,lifecycleId:input.lifecycleId,revision:input.revision,round:input.round,calendarDay:input.calendarDay,policy,dailyUsageSeconds:input.dailyUsageSeconds,pendingPolicy,history,stage,lastReceipt:null};
  s.lastReceipt=validateReceipt(s,input.lastReceipt);return s;
}
export function getGuardianSession(input){return currentSession(validateGuardianLifecycle(input));}
export function getGuardianView(input){
  const s=validateGuardianLifecycle(input),session=currentSession(s);
  return {lifecycleId:s.lifecycleId,revision:s.revision,roundId:s.round?roundId(s):null,phase:session.phase,dayKey:session.dayKey,
    dailySeconds:s.dailyUsageSeconds,cycleSeconds:session.cycleSeconds,pendingGrant:session.pendingGrant,policyPending:s.pendingPolicy!==null,
    question:s.stage.kind==='quiz'?getCurrentQuestion(unpackQuiz(s.stage.progress,s.history).attempt):null,
    rest:s.stage.kind==='rest'?getRestStatus(s.stage.progress):null};
}

export function getGuardianPolicyStatus(input){
  const s=validateGuardianLifecycle(input);return {activePolicy:structuredClone(s.policy),pendingPolicy:structuredClone(s.pendingPolicy),
    effect:s.pendingPolicy===null?'active':s.stage.kind==='rest'?'after_current_rest':'after_current_challenge'};
}

/** A transition computes the entire new snapshot. The caller must atomically commit it. */
export function applyGuardianCommand(input,commandInput,context={}){
  const s=validateGuardianLifecycle(input),c=normalizeCommand(commandInput);
  check(c.lifecycleId===s.lifecycleId,'Command belongs to another lifecycle','CONFLICT');
  if(s.lastReceipt?.command.eventId===c.eventId){
    check(same(c,s.lastReceipt.command),'Event ID conflicts with its stored receipt','CONFLICT');
    return {state:s,duplicate:true,feedback:s.lastReceipt.feedback};
  }
  check(c.expectedRevision===s.revision,'Lifecycle command revision is stale','CONFLICT');
  const revision=advanceCounter(s.revision),p=c.payload;let stage=s.stage,history=s.history,round=s.round,calendarDay=s.calendarDay,policy=s.policy,pendingPolicy=s.pendingPolicy,dailyUsageSeconds=s.dailyUsageSeconds,feedback=null,restCompletion=null;
  switch(c.type){
    case 'record_usage':{
      const current=currentSession(s);
      check((stage.kind==='session' || stage.kind==='quiz' && stage.progress.completion!==null) && current.phase===Phase.AVAILABLE,'Usage is not currently permitted','INVALID_STATE');
      const next=recordUsage(current,p.seconds);dailyUsageSeconds+=next.dailySeconds-current.dailySeconds;stage={kind:'session',session:next};break;
    }
    case 'begin_quiz':{
      const session=currentSession(s);check(session.phase===Phase.CHALLENGE_REQUIRED,'A new quiz is not required','INVALID_STATE');
      round=advanceCounter(round);const attempt=action(()=>startQuiz(session,context?.bank,p));
      const progress=action(()=>createQuizProgress(roundId({...s,round}),attempt,history));stage={kind:'quiz',progress:packQuiz(progress)};break;
    }
    case 'answer':{
      check(stage.kind==='quiz' && stage.progress.attempt.session.phase===Phase.CHALLENGE_ACTIVE,'There is no active quiz','INVALID_STATE');
      const progress=unpackQuiz(stage.progress,history),final=progress.revision===progress.attempt.questions.length-1;
      check(final?p.restAnchor!==null:p.restAnchor===null,'Answer has an unrelated rest anchor','INVALID_COMMAND');
      const submitted=action(()=>submitProgressAnswer(progress,{attemptId:progress.attemptId,expectedRevision:progress.revision,questionId:p.questionId,chosen:p.chosen,completedAt:p.completedAt}));
      history=submitted.progress.history;feedback=submitted.feedback;
      stage=submitted.progress.attempt.session.phase===Phase.REST_REQUIRED?
        {kind:'rest',quiz:packQuiz(submitted.progress),progress:action(()=>createRestProgress(progress.attemptId,submitted.progress.attempt.session,p.restAnchor))}:
        {kind:'quiz',progress:packQuiz(submitted.progress)};break;
    }
    case 'observe_rest':{
      check(stage.kind==='rest','There is no pending rest','INVALID_STATE');
      const observed=action(()=>observeRestInterval(stage.progress,{restId:stage.progress.restId,expectedRevision:stage.progress.revision,...p}));stage={...stage,progress:observed.progress};break;
    }
    case 'complete_rest':{
      check(stage.kind==='rest','There is no pending rest','INVALID_STATE');
      const completed=action(()=>completeVerifiedRest(stage.progress,p.checkpoint));restCompletion={progress:completed.progress,quiz:stage.quiz};
      if(pendingPolicy!==null){policy=pendingPolicy;pendingPolicy=null;}
      stage={kind:'session',session:ordinarySession(completed.session,policy,dailyUsageSeconds,calendarDay)};break;
    }
    case 'roll_day':{
      check(p.nextDay>calendarDay,'Calendar rollover must advance the verified day','INVALID_COMMAND');calendarDay=p.nextDay;dailyUsageSeconds=0;
      if(stage.kind==='session')stage={kind:'session',session:ordinarySession(stage.session,policy,dailyUsageSeconds,calendarDay)};
      else if(stage.kind==='quiz' && stage.progress.completion===null){
        const progress=unpackQuiz(stage.progress,history);progress.attempt.session=rollDay(progress.attempt.session,calendarDay);stage={kind:'quiz',progress:packQuiz(progress)};
      }
      break;
    }
    case 'set_policy':{
      if(unsafePolicyBoundary(stage))pendingPolicy=same(p.policy,policy)?null:p.policy;
      else{policy=p.policy;pendingPolicy=null;if(stage.kind==='session')stage={kind:'session',session:ordinarySession(stage.session,policy,dailyUsageSeconds,calendarDay)};}
      break;
    }
  }
  if(stage.kind==='quiz' && stage.progress.completion!==null && pendingPolicy!==null){policy=pendingPolicy;pendingPolicy=null;}
  const state=validateGuardianLifecycle({...s,revision,round,calendarDay,policy,pendingPolicy,dailyUsageSeconds,history,stage,lastReceipt:{command:c,feedback,restCompletion}});
  return {state,duplicate:false,feedback};
}
export function encodeGuardianLifecycle(input){
  const text=JSON.stringify(validateGuardianLifecycle(input));check(text.length<=LIMIT,'Lifecycle snapshot is too large','SNAPSHOT_TOO_LARGE');return text;
}
export function decodeGuardianLifecycle(text){
  check(typeof text==='string','Expected serialized lifecycle');check(text.length<=LIMIT,'Lifecycle snapshot is too large','SNAPSHOT_TOO_LARGE');
  let value;try{value=JSON.parse(text);}catch{throw new GuardianError('INVALID_LIFECYCLE','Malformed lifecycle JSON');}
  return validateGuardianLifecycle(value);
}
