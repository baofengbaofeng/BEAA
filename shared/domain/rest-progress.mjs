import { Phase,finishRest } from './engine.mjs';
import { validateSession } from './snapshot.mjs';

const LIMIT=1_000_000;
const CONDITIONS=['resting','active','unknown'];
const RESET_REASONS=[null,'boot_changed','clock_discontinuity','gap'];
export class RestProgressError extends Error {
  constructor(code,message){super(message);this.name='RestProgressError';this.code=code;}
}
function check(condition,message,code='INVALID_REST'){
  if(!condition)throw new RestProgressError(code,message);
}
function fields(value,keys,code='INVALID_REST'){
  check(value!==null && typeof value==='object' && !Array.isArray(value),'Expected rest data object',code);
  check(keys.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>keys.includes(k)),'Missing or unknown rest fields',code);
}
function id(value){return typeof value==='string' && value.length>0 && value.length<=128 && value.trim()===value;}
function integer(value){return Number.isSafeInteger(value) && value>=0;}
function checkpoint(input){
  fields(input,['bootId','monotonicMs'],'INVALID_CHECKPOINT');
  check(id(input.bootId) && integer(input.monotonicMs),'Invalid monotonic clock checkpoint','INVALID_CHECKPOINT');
  return {bootId:input.bootId,monotonicMs:input.monotonicMs};
}
function command(input){
  fields(input,['restId','expectedRevision','bootId','fromMs','toMs','condition'],'INVALID_INTERVAL');
  check(id(input.restId) && integer(input.expectedRevision) && id(input.bootId),'Invalid rest event identity','INVALID_INTERVAL');
  check(integer(input.fromMs) && integer(input.toMs) && input.toMs>=input.fromMs && input.toMs-input.fromMs<=86_400_000 &&
    CONDITIONS.includes(input.condition),'Invalid verified interval','INVALID_INTERVAL');
  return {restId:input.restId,expectedRevision:input.expectedRevision,bootId:input.bootId,
    fromMs:input.fromMs,toMs:input.toMs,condition:input.condition};
}
function sourceSession(input){
  let source;
  try{source=validateSession(input);}catch{throw new RestProgressError('INVALID_REST','Invalid source rest session');}
  check(source.phase===Phase.REST_REQUIRED && source.pendingGrant,'Rest requires a completed passing challenge');
  return source;
}
function verifiedMs(progress){return progress.restStartedMs===null?0:progress.cursorMs-progress.restStartedMs;}
function ready(progress){return verifiedMs(progress)>=progress.sourceSession.policy.restMinutes*60_000;}
function deriveSession(progress){
  if(progress.completion===null)return structuredClone(progress.sourceSession);
  // Supply only the policy-required seconds; a long verified run cannot overflow engine input.
  return finishRest(progress.sourceSession,progress.sourceSession.policy.restMinutes*60);
}
function nextRevision(progress){
  check(progress.revision<Number.MAX_SAFE_INTEGER,'Rest revision exhausted','REVISION_EXHAUSTED');return progress.revision+1;
}

/** Inputs are trusted platform attestations; this module never samples a device or wall clock. */
export function createRestProgress(restId,session,anchorInput){
  const anchor=checkpoint(anchorInput);
  return validateRestProgress({schemaVersion:1,restId,revision:0,sourceSession:sourceSession(session),
    bootId:anchor.bootId,cursorMs:anchor.monotonicMs,restStartedMs:null,lastInterval:null,completion:null});
}

export function validateRestProgress(input){
  fields(input,['schemaVersion','restId','revision','sourceSession','bootId','cursorMs','restStartedMs','lastInterval','completion']);
  check(input.schemaVersion===1,'Unsupported rest snapshot version','UNSUPPORTED_VERSION');
  check(id(input.restId) && integer(input.revision) && id(input.bootId) && integer(input.cursorMs),'Invalid rest snapshot metadata');
  check(input.restStartedMs===null || integer(input.restStartedMs) && input.restStartedMs<=input.cursorMs,'Invalid continuous rest boundary');
  const source=sourceSession(input.sourceSession);let completion=null;
  if(input.completion!==null){
    completion=checkpoint(input.completion);
    check(completion.bootId===input.bootId && completion.monotonicMs>=input.cursorMs,'Completion checkpoint disagrees with evidence');
    check(input.revision>=1 && ready({...input,sourceSession:source}),'Completed rest lacks sufficient evidence');
  }
  const observedCount=input.revision-(completion===null?0:1);let lastInterval=null;
  if(input.lastInterval===null){
    check(observedCount===0 && input.restStartedMs===null,'Rest evidence is missing its latest interval');
  }else{
    fields(input.lastInterval,['command','resetReason']);const event=command(input.lastInterval.command),reason=input.lastInterval.resetReason;
    check(observedCount>=1 && event.expectedRevision===observedCount-1 && event.restId===input.restId,'Rest interval revision or identity disagrees');
    check(event.bootId===input.bootId && event.toMs===input.cursorMs && RESET_REASONS.includes(reason),'Rest interval and observation boundary disagree');
    if(reason==='boot_changed' || reason==='clock_discontinuity' || event.condition!=='resting'){
      check(input.restStartedMs===null,'Discontinuous or unverified interval still carries rest credit');
    }else if(reason==='gap'){
      check(input.restStartedMs===event.fromMs,'Gap credit starts outside its verified interval');
    }else{
      // The first observation cannot inherit credit from any earlier interval.
      check(input.restStartedMs!==null && (observedCount===1?input.restStartedMs===event.fromMs:input.restStartedMs<=event.fromMs),'Continuous evidence has no valid start');
    }
    lastInterval={command:event,resetReason:reason};
  }
  return {schemaVersion:1,restId:input.restId,revision:input.revision,sourceSession:source,
    bootId:input.bootId,cursorMs:input.cursorMs,restStartedMs:input.restStartedMs,lastInterval,completion};
}

/** A verified interval must cover its ENTIRE condition; two idle point samples are insufficient. */
export function observeRestInterval(input,commandInput){
  const progress=validateRestProgress(input),event=command(commandInput);
  check(event.restId===progress.restId,'Rest event belongs to another round','CONFLICT');
  if(progress.lastInterval && JSON.stringify(event)===JSON.stringify(progress.lastInterval.command)){
    return {progress,duplicate:true,reason:'duplicate'};
  }
  check(progress.completion===null,'Rest was already completed','ALREADY_COMPLETED');
  check(event.expectedRevision===progress.revision,'Rest event conflicts with stored revision','CONFLICT');
  const revision=nextRevision(progress);let resetReason=null,restStartedMs=null;
  if(event.bootId!==progress.bootId)resetReason='boot_changed';
  else if(event.fromMs<progress.cursorMs)resetReason='clock_discontinuity';
  else{
    if(event.fromMs>progress.cursorMs)resetReason='gap';
    if(event.condition==='resting')restStartedMs=resetReason==='gap'||progress.restStartedMs===null?event.fromMs:progress.restStartedMs;
  }
  const next=validateRestProgress({...progress,revision,bootId:event.bootId,cursorMs:event.toMs,restStartedMs,
    lastInterval:{command:event,resetReason}});
  return {progress:next,duplicate:false,reason:resetReason??event.condition};
}

/** ready describes saved evidence. A new completion additionally requires a current checkpoint. */
export function getRestStatus(input){
  const progress=validateRestProgress(input),elapsed=verifiedMs(progress),required=progress.sourceSession.policy.restMinutes*60_000;
  return {restId:progress.restId,revision:progress.revision,verifiedSeconds:Math.floor(elapsed/1000),
    remainingSeconds:Math.ceil(Math.max(0,required-elapsed)/1000),ready:ready(progress),completed:progress.completion!==null,
    phase:deriveSession(progress).phase};
}
export function getRestSession(input){return deriveSession(validateRestProgress(input));}

/** Save the returned aggregate atomically before acting on completion. Never reuse a rest ID. */
export function completeVerifiedRest(input,checkpointInput){
  const progress=validateRestProgress(input),current=checkpoint(checkpointInput);
  if(progress.completion!==null)return {progress,session:deriveSession(progress),duplicate:true};
  check(current.bootId===progress.bootId && current.monotonicMs>=progress.cursorMs,'Current clock does not confirm saved evidence','STALE_EVIDENCE');
  check(ready(progress),'Verified rest is not complete','REST_NOT_COMPLETE');
  const next=validateRestProgress({...progress,revision:nextRevision(progress),completion:current});
  return {progress:next,session:deriveSession(next),duplicate:false};
}
export function encodeRestProgress(input){
  const text=JSON.stringify(validateRestProgress(input));
  check(text.length<=LIMIT,'Rest snapshot is too large','SNAPSHOT_TOO_LARGE');return text;
}
export function decodeRestProgress(text){
  check(typeof text==='string','Expected serialized rest progress');
  check(text.length<=LIMIT,'Rest snapshot is too large','SNAPSHOT_TOO_LARGE');
  let value;try{value=JSON.parse(text);}catch{throw new RestProgressError('INVALID_REST','Malformed rest JSON');}
  return validateRestProgress(value);
}
