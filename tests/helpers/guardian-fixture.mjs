import { readFileSync } from 'node:fs';
import { createGuardianLifecycle,applyGuardianCommand,getGuardianSession } from '../../shared/domain/guardian-lifecycle.mjs';
export const bank=JSON.parse(readFileSync(new URL('../../shared/quiz/sample-questions.json',import.meta.url),'utf8'));
export const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
export const freshGuardian=(overrides={})=>createGuardianLifecycle('family-ledger-1',{...policy,...overrides},'2026-11-05');
export const cmd=(s,type,payload)=>({lifecycleId:s.lifecycleId,eventId:`event-${s.revision}`,expectedRevision:s.revision,type,payload});
export const step=(s,type,payload,context={bank})=>applyGuardianCommand(s,cmd(s,type,payload),context).state;
export const beginGuardian=s=>step(step(s,'record_usage',{seconds:1800}),'begin_quiz',{knowledgePoints:[]});
export function answerCmd(s,wrong=false){
 const p=s.stage.progress,q=p.attempt.questions[p.revision],final=p.revision===p.attempt.questions.length-1;
 return cmd(s,'answer',{questionId:q.id,chosen:wrong?q.options.find(o=>o.id!==q.correctOptionId).id:q.correctOptionId,
   completedAt:final?1793836800000+s.round*1000:null,restAnchor:final?{bootId:'boot-1',monotonicMs:s.round*1000000}:null});
}
export function answerGuardian(s,wrong=false){while(getGuardianSession(s).phase==='CHALLENGE_ACTIVE')s=applyGuardianCommand(s,answerCmd(s,wrong)).state;return s;}
export function observeGuardian(s,ms=600000){const p=s.stage.progress;return step(s,'observe_rest',{bootId:p.bootId,fromMs:p.cursorMs,toMs:p.cursorMs+ms,condition:'resting'});}
export const completeCmd=s=>cmd(s,'complete_rest',{checkpoint:{bootId:s.stage.progress.bootId,monotonicMs:s.stage.progress.cursorMs}});
export function finishGuardian(s){const ready=observeGuardian(s);return applyGuardianCommand(ready,completeCmd(ready)).state;}
