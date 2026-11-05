import { mkdtempSync,writeFileSync,readFileSync,renameSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Phase } from './engine.mjs';
import { getLearningStats } from './learning-history.mjs';
import { createGuardianLifecycle,decodeGuardianLifecycle,encodeGuardianLifecycle,getGuardianSession,getGuardianView } from './guardian-lifecycle.mjs';
import { commitGuardianCommand } from './lifecycle-controller.mjs';

const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,
  questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const bank=JSON.parse(readFileSync(new URL('../quiz/sample-questions.json',import.meta.url),'utf8'));
const choices={'math-g3-001':'C','math-g3-002':'B','math-g3-003':'C','chinese-g3-001':'A','english-g3-001':'C'};
let lifecycle=createGuardianLifecycle('demo-ledger-1',policy,'2026-11-05');
const directory=mkdtempSync(join(tmpdir(),'beaa-lifecycle-demo-'));
try{
  const file=join(directory,'lifecycle.json');writeFileSync(file,encodeGuardianLifecycle(lifecycle),{mode:0o600});
  // A single process exclusively owns this temporary file. Synchronous CAS has no await gap.
  // No multi-process lock, fsync/power-loss guarantee, authentication or native backend is provided.
  const store={
    async read(){return readFileSync(file,'utf8');},
    async compareAndSwap(expected,text){
      const current=decodeGuardianLifecycle(readFileSync(file,'utf8'));
      if(current.lifecycleId!==expected.lifecycleId || current.revision!==expected.revision)return false;
      const temporary=join(directory,'lifecycle.next');writeFileSync(temporary,text,{mode:0o600});renameSync(temporary,file);return true;
    }
  };
  async function submit(type,payload,context={}){
    const event={lifecycleId:lifecycle.lifecycleId,eventId:`demo-event-${lifecycle.revision}`,expectedRevision:lifecycle.revision,type,payload};
    const result=await commitGuardianCommand(store,event,context);lifecycle=decodeGuardianLifecycle(await store.read());return {event,result};
  }
  // Every duration, interval condition, boot ID and calendar date below is synthetic input.
  await submit('record_usage',{seconds:1800});console.log('30分钟后:',getGuardianSession(lifecycle).phase);
  await submit('begin_quiz',{knowledgePoints:[]},{bank});console.log('题库组卷:',lifecycle.stage.progress.attempt.questions.length,'题');
  async function answerCurrent(){
    const question=getGuardianView(lifecycle).question,final=lifecycle.stage.progress.revision===policy.questionCount-1;
    return submit('answer',{questionId:question.id,chosen:choices[question.id],
      completedAt:final?Date.UTC(2026,10,5,10):null,restAnchor:final?{bootId:'demo-boot',monotonicMs:1000}:null});
  }
  for(let i=0;i<2;i++)await answerCurrent();
  lifecycle=decodeGuardianLifecycle(await store.read());console.log('单文件答题恢复:',getGuardianSession(lifecycle).phase,'已答题:',lifecycle.stage.progress.revision);
  let last;
  while(getGuardianSession(lifecycle).phase===Phase.CHALLENGE_ACTIVE)last=await answerCurrent();
  console.log('答题通过并归档/进入休息:',getGuardianSession(lifecycle).phase,'学习轮数:',getLearningStats(lifecycle.history).quizCount);
  console.log('末题重试:',(await commitGuardianCommand(store,last.event)).outcome);
  await submit('observe_rest',{bootId:'demo-boot',fromMs:1000,toMs:301000,condition:'resting'});
  lifecycle=decodeGuardianLifecycle(await store.read());const half=getGuardianView(lifecycle).rest;
  console.log('单文件休息恢复（合成）:',half.verifiedSeconds,'秒，仍需',half.remainingSeconds,'秒');
  await submit('observe_rest',{bootId:'demo-boot',fromMs:301000,toMs:601000,condition:'resting'});
  const completed=await submit('complete_rest',{checkpoint:{bootId:'demo-boot',monotonicMs:601000}});
  console.log('休息完成:',getGuardianSession(lifecycle).phase,'今日累计秒数:',getGuardianSession(lifecycle).dailySeconds);
  console.log('重复完成休息:',(await commitGuardianCommand(store,completed.event)).outcome);
  await submit('record_usage',{seconds:1800});await submit('begin_quiz',{knowledgePoints:[]},{bank});
  console.log('进入下一轮:',lifecycle.round,'今日累计秒数:',getGuardianSession(lifecycle).dailySeconds,'历史轮数:',getLearningStats(lifecycle.history).quizCount);
}finally{rmSync(directory,{recursive:true,force:true});}
