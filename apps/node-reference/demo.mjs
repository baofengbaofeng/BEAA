import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuardianLifecycle,decodeGuardianLifecycle,getGuardianSession,getGuardianView } from '../../shared/domain/guardian-lifecycle.mjs';
import { commitGuardianCommand } from '../../shared/domain/lifecycle-controller.mjs';
import { getLearningStats } from '../../shared/domain/learning-history.mjs';
import { createSqliteLifecycleStore,openSqliteLifecycleStore,inspectSqliteLifecycleBackup } from './sqlite-store.mjs';

const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const bank=JSON.parse(readFileSync(new URL('../../shared/quiz/sample-questions.json',import.meta.url),'utf8'));
const choices={'math-g3-001':'C','math-g3-002':'B','math-g3-003':'C','chinese-g3-001':'A','english-g3-001':'C'};
const directory=mkdtempSync(join(tmpdir(),'beaa-sqlite-demo-')),path=join(directory,'guardian.sqlite3');
let state=createGuardianLifecycle('sqlite-demo-ledger',policy,'2026-11-05');
try{
  let store=await createSqliteLifecycleStore(path,state);
  async function submit(type,payload,context={}){
    const event={lifecycleId:state.lifecycleId,eventId:`sqlite-demo-${state.revision}`,expectedRevision:state.revision,type,payload};
    const result=await commitGuardianCommand(store,event,context);state=decodeGuardianLifecycle(await store.read());return {event,result};
  }
  // All usage, calendar, boot and rest observations are synthetic; only storage is real SQLite.
  console.log('SQLite参考存储演示；时间/休息输入均为合成数据');
  await submit('record_usage',{seconds:1800});await submit('begin_quiz',{knowledgePoints:[]},{bank});
  async function answer(){
    const q=getGuardianView(state).question,final=state.stage.progress.revision===4;
    return submit('answer',{questionId:q.id,chosen:choices[q.id],completedAt:final?1793836800000:null,
      restAnchor:final?{bootId:'synthetic-boot',monotonicMs:1000}:null});
  }
  for(let i=0;i<2;i++)await answer();store=await openSqliteLifecycleStore(path);state=decodeGuardianLifecycle(await store.read());
  console.log('重新打开数据库：已答',state.stage.progress.revision,'题');
  let last;while(getGuardianView(state).question)last=await answer();
  console.log('末题重试:',(await commitGuardianCommand(store,last.event)).outcome,'学习轮数:',getLearningStats(state.history).quizCount);
  await submit('observe_rest',{bootId:'synthetic-boot',fromMs:1000,toMs:301000,condition:'resting'});
  store=await openSqliteLifecycleStore(path);state=decodeGuardianLifecycle(await store.read());
  console.log('数据库恢复合成休息:',getGuardianView(state).rest.verifiedSeconds,'秒');
  const backupPath=join(directory,'checkpoint.sqlite3'),backup=await store.backup(backupPath);
  console.log('一致性备份修订号:',backup.revision);
  await submit('observe_rest',{bootId:'synthetic-boot',fromMs:301000,toMs:601000,condition:'resting'});
  const complete=await submit('complete_rest',{checkpoint:{bootId:'synthetic-boot',monotonicMs:601000}});
  console.log('休息完成:',getGuardianSession(state).phase,'累计秒数:',getGuardianSession(state).dailySeconds);
  console.log('完成重试:',(await commitGuardianCommand(store,complete.event)).outcome);
  await submit('record_usage',{seconds:1800});await submit('begin_quiz',{knowledgePoints:[]},{bank});
  console.log('第二轮已开始，日累计:',getGuardianSession(state).dailySeconds,'秒；保留学习轮数:',getLearningStats(state.history).quizCount);
  const inspected=await inspectSqliteLifecycleBackup(backupPath);
  console.log('只读备份检查:',inspected.revision,'；当前修订号:',state.revision,'（未回滚）');
}finally{rmSync(directory,{recursive:true,force:true});}
