import {validateGuardianLifecycle,getGuardianSession,decodeGuardianLifecycle,applyGuardianCommand} from './guardian-lifecycle.mjs';

const MESSAGES={INVALID_LIFECYCLE:'Invalid committed lifecycle',INVALID_STORE:'A readable lifecycle store is required',STORE_FAILURE:'Unable to read the committed lifecycle',SCOPE_MISMATCH:'Reminder snapshots belong to different lifecycles',INVALID_TRANSITION:'Expected adjacent snapshots of the same usage command'};
export class UsageReminderError extends Error {
  constructor(code){super(MESSAGES[code]);this.name='UsageReminderError';this.code=code;}
}
function lifecycle(input){
  try{return validateGuardianLifecycle(input);}catch{throw new UsageReminderError('INVALID_LIFECYCLE');}
}
function sorted(value){
  return Array.isArray(value)?value.map(sorted):value!==null && typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
}
function same(a,b){return JSON.stringify(sorted(a))===JSON.stringify(sorted(b));}
function guidance(state){
  const session=getGuardianSession(state),cycleRemainingSeconds=Math.max(0,session.policy.periodMinutes*60-session.cycleSeconds),
    dailyRemainingSeconds=Math.max(0,session.policy.dailyLimitMinutes*60-state.dailyUsageSeconds),
    available=session.phase==='AVAILABLE',remainingUsageSeconds=available?Math.min(cycleRemainingSeconds,dailyRemainingSeconds):0;
  return {
    lifecycleId:state.lifecycleId,revision:state.revision,round:state.round,dayKey:state.calendarDay,phase:session.phase,
    cycleUsedSeconds:session.cycleSeconds,dailyUsedSeconds:state.dailyUsageSeconds,cycleRemainingSeconds,dailyRemainingSeconds,remainingUsageSeconds,
    limitingRule:dailyRemainingSeconds<=cycleRemainingSeconds?'daily_limit':'cycle',
    level:!available?'blocked':remainingUsageSeconds<=60?'one_minute':remainingUsageSeconds<=300?'five_minutes':'none',
    usageSecondsUntilNextBoundary:!available?null:remainingUsageSeconds>300?remainingUsageSeconds-300:remainingUsageSeconds>60?remainingUsageSeconds-60:remainingUsageSeconds,
    advisoryOnly:true
  };
}

/** Effective usage seconds, never wall-clock delay or permission to release a device. */
export function getUsageGuidance(input){return guidance(lifecycle(input));}

/**
 * Call with captured snapshots after a confirmed commit. Replay verifies the arithmetic,
 * not persistence, device sampling or notification delivery. Identical pairs have stable
 * IDs; the caller still owns deduplication and must recheck current state before delivery.
 */
export function getUsageReminderEvent(beforeInput,afterInput){
  const before=lifecycle(beforeInput),after=lifecycle(afterInput);
  if(before.lifecycleId!==after.lifecycleId)throw new UsageReminderError('SCOPE_MISMATCH');
  if(same(before,after))return null;
  if(after.revision!==before.revision+1)throw new UsageReminderError('INVALID_TRANSITION');
  const command=after.lastReceipt.command;
  if(command.type!=='record_usage')return null;
  try{
    if(!same(applyGuardianCommand(before,command).state,after))throw new Error();
  }catch{throw new UsageReminderError('INVALID_TRANSITION');}
  const previous=guidance(before),next=guidance(after),remaining=next.remainingUsageSeconds;
  if(remaining>=previous.remainingUsageSeconds)return null;
  const fresh=previous.cycleUsedSeconds===0;
  const kind=remaining===0?'time_up':remaining<=60 && (previous.remainingUsageSeconds>60 || fresh)?'one_minute':
    remaining<=300 && (previous.remainingUsageSeconds>300 || fresh)?'five_minutes':null;
  if(kind===null)return null;
  return {reminderId:JSON.stringify([after.lifecycleId,after.revision,kind]),lifecycleId:after.lifecycleId,revision:after.revision,round:after.round,
    dayKey:after.calendarDay,kind,remainingSeconds:remaining,limitingRule:next.limitingRule,phase:next.phase,advisoryOnly:true};
}

/** Logical read only: a storage adapter may recover an interrupted transaction on read. */
export async function readUsageGuidance(store){
  if(!store || typeof store.read!=='function')throw new UsageReminderError('INVALID_STORE');
  let text,state;
  try{text=await store.read();}catch{throw new UsageReminderError('STORE_FAILURE');}
  try{state=decodeGuardianLifecycle(text);}catch{throw new UsageReminderError('INVALID_LIFECYCLE');}
  return guidance(state);
}
