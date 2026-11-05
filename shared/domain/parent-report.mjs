import { decodeGuardianLifecycle } from './guardian-lifecycle.mjs';
import { getLearningStats,listLearningRecords,getWrongAnswers } from './learning-history.mjs';

export class ParentReportError extends Error {
  constructor(code,message){super(message);this.name='ParentReportError';this.code=code;}
}
function check(ok,code,message){if(!ok)throw new ParentReportError(code,message);}
async function authorize(authorizer,token){
  let grant;try{grant=await authorizer.authorize(token);}catch{throw new ParentReportError('PARENT_UNAUTHORIZED','Parent authorization required');}
  check(grant && typeof grant==='object' && !Array.isArray(grant) && Object.keys(grant).length===2 &&
    typeof grant.lifecycleId==='string' && grant.lifecycleId.length>0 && grant.lifecycleId.length<=96 && grant.lifecycleId.trim()===grant.lifecycleId &&
    Number.isSafeInteger(grant.credentialVersion) && grant.credentialVersion>=1,'PARENT_UNAUTHORIZED','Invalid parent authorization proof');
  return {lifecycleId:grant.lifecycleId,credentialVersion:grant.credentialVersion};
}
/** authorizer is a trusted service dependency, never a client-supplied boolean or proof. */
export async function getParentLearningReport(store,authorizer,token,query={}){
  check(authorizer && typeof authorizer.authorize==='function','INVALID_AUTHORIZER','A trusted parent authorizer is required');
  check(store && typeof store.read==='function','INVALID_STORE','A committed lifecycle store is required');
  let captured;try{captured=structuredClone(query);}catch{throw new ParentReportError('INVALID_QUERY','Invalid report query');}
  const before=await authorize(authorizer,token);let text;
  try{text=await store.read();}catch{throw new ParentReportError('STORE_FAILURE','Unable to read the learning report source');}
  let source;try{source=decodeGuardianLifecycle(text);}catch{throw new ParentReportError('INVALID_REPORT_SOURCE','Invalid learning report source');}
  check(before.lifecycleId===source.lifecycleId,'PARENT_SCOPE_MISMATCH','Parent authorization belongs to another ledger');
  let report;
  try{report={revision:source.revision,dayKey:source.calendarDay,stats:getLearningStats(source.history,captured),records:listLearningRecords(source.history,captured),wrongAnswers:getWrongAnswers(source.history,captured)};}
  catch{throw new ParentReportError('INVALID_QUERY','Invalid report query');}
  const after=await authorize(authorizer,token);
  check(after.lifecycleId===before.lifecycleId && after.credentialVersion===before.credentialVersion,'PARENT_AUTH_CHANGED','Parent authorization changed while reading');
  return report;
}
