import { decodeGuardianLifecycle,applyGuardianCommand,encodeGuardianLifecycle,getGuardianView,getGuardianPolicyStatus } from './guardian-lifecycle.mjs';

export class ParentPolicyError extends Error {
  constructor(code,message){super(message);this.name='ParentPolicyError';this.code=code;}
}
function check(ok,code,message){if(!ok)throw new ParentPolicyError(code,message);}
async function authorize(authorizer,token){
  let proof;try{proof=await authorizer.authorize(token);}catch{throw new ParentPolicyError('PARENT_UNAUTHORIZED','Parent authorization required');}
  check(proof && typeof proof==='object' && !Array.isArray(proof) && Object.keys(proof).length===2 && Object.hasOwn(proof,'lifecycleId') && Object.hasOwn(proof,'credentialVersion') &&
    typeof proof.lifecycleId==='string' && proof.lifecycleId.length>0 && proof.lifecycleId.length<=96 && proof.lifecycleId.trim()===proof.lifecycleId && Number.isSafeInteger(proof.credentialVersion) && proof.credentialVersion>=1,'PARENT_UNAUTHORIZED','Invalid parent authorization proof');
  return {lifecycleId:proof.lifecycleId,credentialVersion:proof.credentialVersion};
}
function transition(input,command){
  try{const result=applyGuardianCommand(input,command);return {...result,text:result.duplicate?null:encodeGuardianLifecycle(result.state)};}
  catch(error){throw new ParentPolicyError(error.code??'INVALID_COMMAND','Policy transition rejected');}
}
/** Trusted authorizer dependency; no client boolean/proof. Only settings, never platform events. */
export async function commitParentPolicyChange(store,authorizer,token,command){
  check(store && typeof store.read==='function' && typeof store.compareAndSwap==='function','INVALID_STORE','An atomic lifecycle store is required');
  check(authorizer && typeof authorizer.authorize==='function','INVALID_AUTHORIZER','A trusted parent authorizer is required');
  let captured;try{captured=structuredClone(command);}catch{throw new ParentPolicyError('INVALID_COMMAND','Policy command cannot be captured');}
  check(captured?.type==='set_policy' && typeof captured.lifecycleId==='string','INVALID_COMMAND','Only policy setting commands are permitted');
  const before=await authorize(authorizer,token);
  check(before.lifecycleId===captured.lifecycleId,'PARENT_SCOPE_MISMATCH','Parent authorization belongs to another ledger');
  let text;try{text=await store.read();}catch{throw new ParentPolicyError('STORE_FAILURE','Unable to read policy source');}
  let previous;try{previous=decodeGuardianLifecycle(text);}catch{throw new ParentPolicyError('INVALID_LIFECYCLE','Invalid policy source snapshot');}
  check(previous.lifecycleId===before.lifecycleId,'PARENT_SCOPE_MISMATCH','Parent authorization belongs to another ledger');
  const applied=transition(previous,captured),after=await authorize(authorizer,token);
  check(after.lifecycleId===before.lifecycleId && after.credentialVersion===before.credentialVersion,'PARENT_AUTH_CHANGED','Parent authorization changed before commit');
  // This is the authorization check point. A separate credential database does not
  // make revocation and the already accepted lifecycle CAS one cross-database transaction.
  if(!applied.duplicate){
    let committed;
    try{committed=await store.compareAndSwap({lifecycleId:previous.lifecycleId,revision:previous.revision},applied.text);}
    catch{throw new ParentPolicyError('STORE_FAILURE','Policy commit acknowledgement unavailable; read and retry the same command');}
    check(typeof committed==='boolean','STORE_FAILURE','Invalid policy commit response');check(committed,'CONFLICT','Policy changed before commit; read before retrying');
  }
  return {outcome:applied.duplicate?'duplicate':'committed',...getGuardianView(applied.state),settings:getGuardianPolicyStatus(applied.state)};
}
