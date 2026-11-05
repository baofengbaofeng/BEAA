import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuardianLifecycle,decodeGuardianLifecycle,getGuardianView } from '../../shared/domain/guardian-lifecycle.mjs';
import { commitGuardianCommand } from '../../shared/domain/lifecycle-controller.mjs';
import { getParentLearningReport } from '../../shared/domain/parent-report.mjs';
import { commitParentPolicyChange } from '../../shared/domain/parent-policy.mjs';
import { createSqliteLifecycleStore } from './sqlite-store.mjs';
import { createParentAuthService } from './parent-auth.mjs';

const directory=mkdtempSync(join(tmpdir(),'beaa-parent-demo-'));
const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const bank=JSON.parse(readFileSync(new URL('../../shared/quiz/sample-questions.json',import.meta.url),'utf8'));
// Disposable fixture values, never print PINs, bearer tokens or stored digests.
const DEMO_PIN='482619',NEXT_PIN='739152';
let state=createGuardianLifecycle('parent-demo-ledger',policy,'2026-11-05');
try{
  const store=await createSqliteLifecycleStore(join(directory,'guardian.sqlite3'),state);
  const auth=await createParentAuthService(join(directory,'parent.sqlite3'),state.lifecycleId,DEMO_PIN);
  async function submit(type,payload,context={}){
    await commitGuardianCommand(store,{lifecycleId:state.lifecycleId,eventId:`parent-demo-${state.revision}`,expectedRevision:state.revision,type,payload},context);
    state=decodeGuardianLifecycle(await store.read());
  }
  await submit('record_usage',{seconds:1800});await submit('begin_quiz',{knowledgePoints:[]},{bank});
  const choices={'chinese-g3-001':'B','math-g3-001':'C','math-g3-002':'B','math-g3-003':'C','english-g3-001':'C'};
  while(getGuardianView(state).question){
    const q=getGuardianView(state).question,final=state.stage.progress.revision===4;
    await submit('answer',{questionId:q.id,chosen:choices[q.id],completedAt:final?1793836800000:null,restAnchor:final?{bootId:'synthetic-boot',monotonicMs:1000}:null});
  }
  console.log('家长验证参考演示；学习/使用输入均为合成数据');
  try{await getParentLearningReport(store,auth,null);}catch(error){console.log('未授权查询:',error.code);}
  const login=await auth.login(DEMO_PIN),report=await getParentLearningReport(store,auth,login.token);
  console.log('授权后报告:',report.stats.quizCount,'轮，正确',report.stats.correctCount,'/',report.stats.answerCount,'，错题',report.wrongAnswers.length);
  auth.logout(login.token);
  try{await getParentLearningReport(store,auth,login.token);}catch(error){console.log('注销后查询:',error.code);}
  const next=await auth.login(DEMO_PIN),updated=await auth.changePin(next.token,NEXT_PIN);
  try{await auth.authorize(next.token);}catch(error){console.log('换PIN后旧授权:',error.code);}
  const renewed=await auth.login(NEXT_PIN);await getParentLearningReport(store,auth,renewed.token);
  console.log('新PIN重新验证成功；凭据版本:',updated.credentialVersion,'；修改设置前修订号:',state.revision);
  const command={lifecycleId:state.lifecycleId,eventId:`parent-settings-${state.revision}`,expectedRevision:state.revision,
    type:'set_policy',payload:{policy:{...state.policy,dailyLimitMinutes:90,requiredCorrect:4}}};
  const saved=await commitParentPolicyChange(store,auth,renewed.token,command);state=decodeGuardianLifecycle(await store.read());
  const unchangedHistory=await getParentLearningReport(store,auth,renewed.token);
  console.log('授权保存设置:',saved.settings.effect,'每日上限',saved.settings.activePolicy.dailyLimitMinutes,'分钟；已用',saved.dailySeconds,'秒');
  console.log('新门槛4/5；当前阶段:',saved.phase,'；历史通过轮数:',unchangedHistory.stats.passedQuizCount);
  console.log('设置重试:',(await commitParentPolicyChange(store,auth,renewed.token,command)).outcome);
}finally{rmSync(directory,{recursive:true,force:true});}
