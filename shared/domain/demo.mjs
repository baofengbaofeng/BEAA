import { mkdtempSync,writeFileSync,readFileSync,renameSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession,recordUsage,Phase } from './engine.mjs';
import { startQuiz,getCurrentQuestion } from './quiz-service.mjs';
import { getLearningStats } from './learning-history.mjs';
import { createQuizProgress,encodeQuizProgress,decodeQuizProgress } from './quiz-progress.mjs';
import { commitQuizAnswer } from './quiz-controller.mjs';
import { createRestProgress,observeRestInterval,getRestStatus,getRestSession,completeVerifiedRest,encodeRestProgress,decodeRestProgress } from './rest-progress.mjs';

const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,
  questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const bank=JSON.parse(readFileSync(new URL('../quiz/sample-questions.json',import.meta.url),'utf8'));
let state=recordUsage(createSession(policy,'2026-11-05'),30*60);
console.log('30分钟后:',state.phase);
let progress=createQuizProgress('demo-round-1',startQuiz(state,bank));
console.log('题库组卷:',progress.attempt.questions.length,'题');
// Simulated child choices and completion metadata; no trusted device clock is available.
const choices={'math-g3-001':'C','math-g3-002':'B','math-g3-003':'C','chinese-g3-001':'A','english-g3-001':'C'};
function answerCommand(current){
  const question=getCurrentQuestion(current.attempt);
  return {attemptId:current.attemptId,expectedRevision:current.revision,questionId:question.id,
    chosen:choices[question.id],completedAt:current.revision===4?Date.UTC(2026,10,5,10):null};
}
const directory=mkdtempSync(join(tmpdir(),'beaa-domain-demo-'));
try{
  const file=join(directory,'progress.json');
  writeFileSync(file,encodeQuizProgress(progress),{mode:0o600});
  // Demonstration only: single process owns this file. Synchronous CAS has no await gap.
  // Rename replaces the whole snapshot; multi-process locking and power-loss durability
  // are NOT implemented or verified here. Native adapters must provide their own guarantees.
  const store={
    async read(){return readFileSync(file,'utf8');},
    async compareAndSwap(expected,text){
      const current=decodeQuizProgress(readFileSync(file,'utf8'));
      if(current.attemptId!==expected.attemptId || current.revision!==expected.revision)return false;
      const temporary=join(directory,'progress.next');
      writeFileSync(temporary,text,{mode:0o600});renameSync(temporary,file);return true;
    }
  };
  for(let i=0;i<2;i++){
    await commitQuizAnswer(store,answerCommand(progress));progress=decodeQuizProgress(await store.read());
  }
  console.log('测验快照恢复:',progress.attempt.session.phase,'已答题:',progress.revision);
  let last;
  while(progress.attempt.session.phase===Phase.CHALLENGE_ACTIVE){
    last=answerCommand(progress);await commitQuizAnswer(store,last);progress=decodeQuizProgress(await store.read());
  }
  console.log('答题通过:',progress.attempt.session.phase);
  const repeated=await commitQuizAnswer(store,last);
  console.log('末题重试:',repeated.outcome,'已答题:',repeated.revision);
  const stats=getLearningStats(progress.history);
  console.log('学习记录恢复:',stats.quizCount,'轮','正确:',stats.correctCount+'/'+stats.answerCount);
  // Synthetic interval attestations only: no device measures actual rest here.
  // Separate quiz/rest files demonstrate component codecs, NOT a lifecycle transaction.
  let rest=createRestProgress(progress.attemptId,progress.attempt.session,{bootId:'demo-boot',monotonicMs:1000});
  function restInterval(current,toMs){
    return {restId:current.restId,expectedRevision:current.revision,bootId:current.bootId,
      fromMs:current.cursorMs,toMs,condition:'resting'};
  }
  rest=observeRestInterval(rest,restInterval(rest,301000)).progress;
  const restFile=join(directory,'rest.json');
  writeFileSync(restFile,encodeRestProgress(rest),{mode:0o600});
  rest=decodeRestProgress(readFileSync(restFile,'utf8'));
  console.log('休息证据恢复（合成）:',getRestStatus(rest).verifiedSeconds,'秒，仍需',getRestStatus(rest).remainingSeconds,'秒');
  rest=observeRestInterval(rest,restInterval(rest,601000)).progress;
  const completed=completeVerifiedRest(rest,{bootId:'demo-boot',monotonicMs:601000});
  writeFileSync(restFile,encodeRestProgress(completed.progress),{mode:0o600});
  rest=decodeRestProgress(readFileSync(restFile,'utf8'));
  const retryRest=completeVerifiedRest(rest,{bootId:'demo-boot',monotonicMs:601000});
  console.log('重复完成休息:',retryRest.duplicate?'duplicate':'unexpected');
  state=getRestSession(rest);
  console.log('休息完成:',state.phase,'今日累计秒数:',state.dailySeconds);
}finally{rmSync(directory,{recursive:true,force:true});}
