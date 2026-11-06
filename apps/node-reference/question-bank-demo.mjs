import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGuardianLifecycle,decodeGuardianLifecycle,getGuardianView} from '../../shared/domain/guardian-lifecycle.mjs';
import {commitGuardianCommand} from '../../shared/domain/lifecycle-controller.mjs';
import {createQuestionBankCatalog,decodeQuestionBankCatalog} from '../../shared/quiz/catalog.mjs';
import {commitParentQuestionBank,beginQuizFromQuestionBank} from '../../shared/domain/question-bank-service.mjs';
import {createSqliteLifecycleStore} from './sqlite-store.mjs';
import {createSqliteQuestionBankStore,openSqliteQuestionBankStore} from './question-bank-store.mjs';
import {createParentAuthService} from './parent-auth.mjs';
const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const bank=JSON.parse(readFileSync(new URL('../../shared/quiz/sample-questions.json',import.meta.url),'utf8'));
const choices={'math-g3-001':'C','math-g3-002':'B','math-g3-003':'C','chinese-g3-001':'A','english-g3-001':'C'};
const directory=mkdtempSync(join(tmpdir(),'beaa-bank-demo-')),bankPath=join(directory,'bank.sqlite3'),lifecycleId='bank-demo-family';
try{
 const ledger=await createSqliteLifecycleStore(join(directory,'ledger.sqlite3'),createGuardianLifecycle(lifecycleId,policy,'2026-11-05'));
 let catalog=await createSqliteQuestionBankStore(bankPath,createQuestionBankCatalog(lifecycleId,bank));
 const auth=await createParentAuthService(join(directory,'auth.sqlite3'),lifecycleId,'739152');
 const command=async(type,payload)=>{const state=decodeGuardianLifecycle(await ledger.read());return {lifecycleId,eventId:'demo-'+state.revision,expectedRevision:state.revision,type,payload};};
 const submit=async(type,payload)=>commitGuardianCommand(ledger,await command(type,payload));
 console.log('题库持久化参考演示：三份真实SQLite；使用/休息均为合成数据，无设备管控。');
 await submit('record_usage',{seconds:1800});await beginQuizFromQuestionBank(ledger,catalog,await command('begin_quiz',{knowledgePoints:[]}));
 const importBank=structuredClone(bank);for(const q of importBank.questions)q.stem='新版练习：'+q.stem;
 const request={lifecycleId,eventId:'bank-demo-import-1',expectedRevision:0,type:'replace_bank',payload:{bank:importBank}};
 await assert.rejects(commitParentQuestionBank(catalog,auth,null,request),e=>e.code==='PARENT_UNAUTHORIZED');
 const {token}=await auth.login('739152'),before=await ledger.read();
 const imported=await commitParentQuestionBank(catalog,auth,token,request);assert.equal(await ledger.read(),before);
 catalog=await openSqliteQuestionBankStore(bankPath);assert.equal(decodeQuestionBankCatalog(await catalog.read()).revision,1);
 console.log('家长验证后导入并重开目录：版本',imported.revision,'题量',imported.summary.questionCount,'；当前答题快照不变');
 assert.equal((await commitParentQuestionBank(catalog,auth,token,request)).outcome,'duplicate');
 let state;
 while(getGuardianView(state=decodeGuardianLifecycle(await ledger.read())).question){
  const question=getGuardianView(state).question,final=state.stage.progress.revision===4;
  await submit('answer',{questionId:question.id,chosen:choices[question.id],completedAt:final?1793836800000:null,restAnchor:final?{bootId:'synthetic-demo-boot',monotonicMs:1000}:null});
 }
 assert.equal(getGuardianView(decodeGuardianLifecycle(await ledger.read())).phase,'REST_REQUIRED');
 await submit('observe_rest',{bootId:'synthetic-demo-boot',fromMs:1000,toMs:601000,condition:'resting'});
 await submit('complete_rest',{checkpoint:{bootId:'synthetic-demo-boot',monotonicMs:601000}});
 await submit('record_usage',{seconds:1800});
 const next=await beginQuizFromQuestionBank(ledger,catalog,await command('begin_quiz',{knowledgePoints:[]}));assert(next.question.stem.startsWith('新版练习：'));
 console.log('原轮按旧题完成，新轮读取新版；日累计',next.dailySeconds,'秒，历史',decodeGuardianLifecycle(await ledger.read()).history.records.length,'轮，未因导入清空');
 auth.logout(token);
}finally{rmSync(directory,{recursive:true,force:true});}
