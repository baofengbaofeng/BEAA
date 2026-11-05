import { QuizProgressError,decodeQuizProgress,encodeQuizProgress,submitProgressAnswer } from './quiz-progress.mjs';

/**
 * Required port: read() -> committed JSON text;
 * compareAndSwap({attemptId,revision}, text) -> boolean.
 * The adapter must atomically compare both fields and durably commit the ENTIRE text.
 * This coordinator supplies no authentication, device permissions or storage backend.
 */
export async function commitQuizAnswer(store,command){
  if(!store || typeof store.read!=='function' || typeof store.compareAndSwap!=='function'){
    throw new QuizProgressError('INVALID_STORE','A complete atomic progress store is required');
  }
  let captured;
  try{captured=structuredClone(command);}catch{throw new QuizProgressError('INVALID_COMMAND','Answer command cannot be captured');}
  let text;
  try{text=await store.read();}catch{throw new QuizProgressError('STORE_FAILURE','Unable to read committed quiz progress');}
  const previous=decodeQuizProgress(text),transition=submitProgressAnswer(previous,captured);
  if(!transition.duplicate){
    // Serialization and every consistency check finish before any write attempt.
    const nextText=encodeQuizProgress(transition.progress);let committed;
    try{committed=await store.compareAndSwap({attemptId:previous.attemptId,revision:previous.revision},nextText);}
    catch{throw new QuizProgressError('STORE_FAILURE','Quiz commit acknowledgement unavailable; read and retry the same command');}
    if(typeof committed!=='boolean')throw new QuizProgressError('STORE_FAILURE','Invalid quiz store commit response');
    if(!committed)throw new QuizProgressError('CONFLICT','Quiz progress changed; read before retrying');
  }
  const {progress,feedback}=transition;
  return {outcome:transition.duplicate?'duplicate':'committed',revision:progress.revision,feedback,
    phase:progress.attempt.session.phase,archiveOutcome:progress.completion?.archiveOutcome??null};
}
