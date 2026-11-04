import { Phase,validatePolicy,validateDayKey } from './engine.mjs';

const MAX_TEXT_LENGTH=1_000_000;
const SESSION_KEYS=['policy','dayKey','phase','dailySeconds','cycleSeconds','challenge','pendingGrant'];
const POLICY_KEYS=['periodMinutes','dailyLimitMinutes','restMinutes','questionCount','requiredCorrect','grade','subjects'];

export class SnapshotError extends Error {
  constructor(code,message){super(message);this.name='SnapshotError';this.code=code;}
}
function check(condition,message,code='INVALID_SESSION') {
  if(!condition)throw new SnapshotError(code,message);
}
function fields(value,allowed,required=allowed,code='INVALID_SESSION') {
  check(value!==null && typeof value==='object' && !Array.isArray(value),'Expected a snapshot object',code);
  check(required.every(key=>Object.hasOwn(value,key)) && Object.keys(value).every(key=>allowed.includes(key)),'Missing or unknown snapshot fields',code);
}
function integer(value,min,max){return Number.isSafeInteger(value) && value>=min && value<=max;}
function identifier(value){return typeof value==='string' && value.length>0;}
function denseArray(value){return Array.isArray(value) && Object.keys(value).length===value.length;}

/** Validate an engine state, not its authenticity or the authority of its clock/answers. */
export function validateSession(input) {
  fields(input,SESSION_KEYS);
  fields(input.policy,[...POLICY_KEYS,'version'],POLICY_KEYS);
  if(Object.hasOwn(input.policy,'version'))check(input.policy.version===1,'Unsupported policy version');
  check(denseArray(input.policy.subjects),'Invalid policy subject list');
  let policy;
  try{policy=validatePolicy(input.policy);validateDayKey(input.dayKey);}catch{throw new SnapshotError('INVALID_SESSION','Invalid policy or calendar date');}
  const cap=policy.dailyLimitMinutes*60,period=policy.periodMinutes*60;
  check(Object.values(Phase).includes(input.phase),'Unknown session phase');
  check(integer(input.dailySeconds,0,cap) && integer(input.cycleSeconds,0,86400),'Invalid usage counters');
  check(typeof input.pendingGrant==='boolean','Invalid pending grant');
  check((input.dailySeconds===cap)===(input.phase===Phase.DAILY_LOCKED),'Daily limit and phase disagree');
  check(input.pendingGrant===(input.phase===Phase.REST_REQUIRED),'Grant and phase disagree');

  let complete=false,passed=false;
  if(input.challenge!==null){
    check(input.cycleSeconds>=period,'Challenge exists before the usage cycle expires');
    fields(input.challenge,['questionIds','answers']);
    const {questionIds,answers}=input.challenge;
    check(denseArray(questionIds) && questionIds.length===policy.questionCount,'Invalid challenge size');
    check(Array.from(questionIds).every(identifier) && new Set(questionIds).size===questionIds.length,'Invalid or duplicate question identifiers');
    check(denseArray(answers) && answers.length<=questionIds.length,'Invalid answer list');
    for(const [index,answer] of answers.entries()){
      fields(answer,['questionId','chosen','correct']);
      check(answer.questionId===questionIds[index] && identifier(answer.chosen) && typeof answer.correct==='boolean','Invalid or out-of-order answer');
    }
    complete=answers.length===questionIds.length;
    passed=complete && answers.filter(answer=>answer.correct).length>=policy.requiredCorrect;
  }
  switch(input.phase){
    case Phase.AVAILABLE:
      check(input.challenge===null && input.cycleSeconds<period,'Available session still requires a challenge');break;
    case Phase.DAILY_LOCKED:
      break; // The daily guard may retain quiz progress; it never holds an active grant.
    case Phase.CHALLENGE_REQUIRED:
      check(input.cycleSeconds>=period && (input.challenge===null || complete && !passed),'Required challenge is inconsistent');break;
    case Phase.CHALLENGE_ACTIVE:
      check(input.cycleSeconds>=period && input.challenge!==null && !complete,'Active challenge is inconsistent');break;
    case Phase.REST_REQUIRED:
      check(input.cycleSeconds>=period && complete && passed,'Rest grant requires a completed passing challenge');break;
  }
  return structuredClone(input);
}

/** Revision is caller-owned metadata, not an atomic write or anti-rollback mechanism. */
export function encodeSession(session,revision=0) {
  check(integer(revision,0,Number.MAX_SAFE_INTEGER),'Invalid snapshot revision','INVALID_SNAPSHOT');
  const text=JSON.stringify({schemaVersion:1,revision,session:validateSession(session)});
  check(text.length<=MAX_TEXT_LENGTH,'Snapshot exceeds the length limit','SNAPSHOT_TOO_LARGE');
  return text;
}

/** Corruption fails explicitly; this function never creates a replacement session. */
export function decodeSession(text) {
  check(typeof text==='string','Expected serialized snapshot text','INVALID_SNAPSHOT');
  check(text.length<=MAX_TEXT_LENGTH,'Snapshot exceeds the length limit','SNAPSHOT_TOO_LARGE');
  let value;
  try{value=JSON.parse(text);}catch{throw new SnapshotError('INVALID_SNAPSHOT','Malformed snapshot JSON');}
  fields(value,['schemaVersion','revision','session'],undefined,'INVALID_SNAPSHOT');
  check(value.schemaVersion===1,'Unsupported snapshot schema version','UNSUPPORTED_VERSION');
  check(integer(value.revision,0,Number.MAX_SAFE_INTEGER),'Invalid snapshot revision','INVALID_SNAPSHOT');
  return {schemaVersion:1,revision:value.revision,session:validateSession(value.session)};
}
