import { GuardianError,decodeGuardianLifecycle,encodeGuardianLifecycle,applyGuardianCommand,getGuardianView } from './guardian-lifecycle.mjs';

/**
 * Port: read() -> committed lifecycle JSON;
 * compareAndSwap({lifecycleId,revision}, completeText) -> boolean.
 * The adapter must atomically compare BOTH fields and durably write the entire snapshot.
 * No authentication, platform sampling, storage implementation or device operation is supplied here.
 */
export async function commitGuardianCommand(store,command,context={}){
  if(!store || typeof store.read!=='function' || typeof store.compareAndSwap!=='function')throw new GuardianError('INVALID_STORE','A complete atomic lifecycle store is required');
  let captured,resources;
  try{captured=structuredClone(command);resources=structuredClone(context);}catch{throw new GuardianError('INVALID_COMMAND','Lifecycle input cannot be captured');}
  if(captured?.type==='set_policy')throw new GuardianError('PARENT_AUTH_REQUIRED','Policy changes require the parent authorization gateway');
  let text;
  try{text=await store.read();}catch{throw new GuardianError('STORE_FAILURE','Unable to read the committed lifecycle');}
  const previous=decodeGuardianLifecycle(text),transition=applyGuardianCommand(previous,captured,resources);
  if(!transition.duplicate){
    const nextText=encodeGuardianLifecycle(transition.state);let committed;
    try{committed=await store.compareAndSwap({lifecycleId:previous.lifecycleId,revision:previous.revision},nextText);}
    catch{throw new GuardianError('STORE_FAILURE','Lifecycle commit acknowledgement unavailable; read and retry the same command');}
    if(typeof committed!=='boolean')throw new GuardianError('STORE_FAILURE','Invalid lifecycle store commit response');
    if(!committed)throw new GuardianError('CONFLICT','Lifecycle changed before commit; read before retrying');
  }
  return {outcome:transition.duplicate?'duplicate':'committed',...getGuardianView(transition.state),feedback:transition.feedback};
}
