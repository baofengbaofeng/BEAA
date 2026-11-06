// Pure bounded-use permit. Authentication, trusted time, usage and persistence belong to the host.
const TEMP_ACCESS_PHASES=['AVAILABLE','CHALLENGE_REQUIRED','CHALLENGE_ACTIVE','REST_REQUIRED','DAILY_LOCKED','SCHEDULE_LOCKED'];
const TEMP_ACCESS_REASONS=[null,'parent_closed','expired','budget_exhausted','clock_rollback'];
export class TemporaryAccessError extends Error {
 constructor(code){super('Temporary access rejected: '+code);this.name='TemporaryAccessError';this.code=code;}
}
function taCheck(ok,code='INVALID_ACCESS'){if(!ok)throw new TemporaryAccessError(code);}
function taInteger(n){return Number.isSafeInteger(n)&&n>=0;}
function taFields(v,keys){taCheck(v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)));}
function taContext(v){
 taFields(v,['nowMs','phase','cycleRemainingSeconds','dailyRemainingSeconds']);
 taCheck(taInteger(v.nowMs)&&TEMP_ACCESS_PHASES.includes(v.phase)&&taInteger(v.cycleRemainingSeconds)&&taInteger(v.dailyRemainingSeconds));return v;
}
export function validateTemporaryAccess(value){
 taFields(value,['version','permitId','issuedAtMs','expiresAtMs','budgetSeconds','usedSeconds','lastObservedAtMs','closedReason']);
 taCheck(value.version===1&&typeof value.permitId==='string'&&value.permitId.trim()===value.permitId&&value.permitId.length>0&&value.permitId.length<=128);
 taCheck(['issuedAtMs','expiresAtMs','budgetSeconds','usedSeconds','lastObservedAtMs'].every(k=>taInteger(value[k])));
 taCheck(value.budgetSeconds>=60&&value.budgetSeconds<=1800&&value.budgetSeconds%60===0&&value.usedSeconds<=value.budgetSeconds);
 taCheck(value.expiresAtMs-value.issuedAtMs===value.budgetSeconds*1000&&value.lastObservedAtMs>=value.issuedAtMs&&TEMP_ACCESS_REASONS.includes(value.closedReason));
 taCheck(value.closedReason!==null||(value.usedSeconds<value.budgetSeconds&&value.lastObservedAtMs<value.expiresAtMs));
 taCheck(value.closedReason!=='expired'||value.lastObservedAtMs>=value.expiresAtMs);
 taCheck(value.closedReason!=='budget_exhausted'||value.usedSeconds===value.budgetSeconds);
 return {...value};
}
export function createTemporaryAccess(request,trustedContext){
 taFields(request,['permitId','minutes']);const c=taContext(trustedContext);
 taCheck(Number.isInteger(request.minutes)&&request.minutes>=1&&request.minutes<=30,'INVALID_REQUEST');
 taCheck(c.phase==='AVAILABLE','NOT_AVAILABLE');const budgetSeconds=request.minutes*60;
 taCheck(budgetSeconds<=c.cycleRemainingSeconds&&budgetSeconds<=c.dailyRemainingSeconds,'INSUFFICIENT_ALLOWANCE');
 return validateTemporaryAccess({version:1,permitId:request.permitId,issuedAtMs:c.nowMs,expiresAtMs:c.nowMs+budgetSeconds*1000,budgetSeconds,usedSeconds:0,lastObservedAtMs:c.nowMs,closedReason:null});
}
export function getTemporaryAccessStatus(value,trustedContext){
 const s=validateTemporaryAccess(value),c=taContext(trustedContext);
 const reason=s.closedReason??(c.nowMs<s.lastObservedAtMs?'clock_rollback':c.nowMs>=s.expiresAtMs?'expired':c.phase!=='AVAILABLE'?'guardian_blocked':c.cycleRemainingSeconds===0||c.dailyRemainingSeconds===0?'allowance_exhausted':null);
 const remainingSeconds=reason===null?Math.min(s.budgetSeconds-s.usedSeconds,Math.ceil((s.expiresAtMs-c.nowMs)/1000),c.cycleRemainingSeconds,c.dailyRemainingSeconds):0;
 return {permitId:s.permitId,active:reason===null,reason,remainingSeconds,expiresAtMs:s.expiresAtMs,usedSeconds:s.usedSeconds,budgetSeconds:s.budgetSeconds,advisoryOnly:true};
}
export function observeTemporaryAccess(value,sample){
 const s=validateTemporaryAccess(value);taFields(sample,['nowMs','usedSeconds']);taCheck(taInteger(sample.nowMs)&&taInteger(sample.usedSeconds),'INVALID_SAMPLE');
 if(s.closedReason!==null){taCheck(sample.usedSeconds===0,'ACCESS_INACTIVE');return s;}
 if(sample.nowMs<s.lastObservedAtMs){taCheck(sample.usedSeconds===0,'ACCESS_INACTIVE');return {...s,closedReason:'clock_rollback'};}
 if(sample.nowMs>=s.expiresAtMs){taCheck(sample.usedSeconds===0,'ACCESS_INACTIVE');return {...s,lastObservedAtMs:sample.nowMs,closedReason:'expired'};}
 taCheck(sample.usedSeconds<=s.budgetSeconds-s.usedSeconds,'BUDGET_EXCEEDED');
 const usedSeconds=s.usedSeconds+sample.usedSeconds;
 return {...s,usedSeconds,lastObservedAtMs:sample.nowMs,closedReason:usedSeconds===s.budgetSeconds?'budget_exhausted':null};
}
export function closeTemporaryAccess(value,nowMs){
 const s=observeTemporaryAccess(value,{nowMs,usedSeconds:0});return s.closedReason===null?{...s,closedReason:'parent_closed'}:s;
}
