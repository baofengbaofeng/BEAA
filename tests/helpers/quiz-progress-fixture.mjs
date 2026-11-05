import { readFileSync } from 'node:fs';
import { createSession,recordUsage } from '../../shared/domain/engine.mjs';
import { startQuiz } from '../../shared/domain/quiz-service.mjs';
import { createQuizProgress,submitProgressAnswer } from '../../shared/domain/quiz-progress.mjs';

const bank=JSON.parse(readFileSync(new URL('../../shared/quiz/sample-questions.json',import.meta.url),'utf8'));
const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
export function fresh(id='round-1',history){
  const attempt=startQuiz(recordUsage(createSession(policy,'2026-11-05'),1800),bank);
  return createQuizProgress(id,attempt,history);
}
export function command(progress,{wrong=false,completedAt=1000}={}){
  const q=progress.attempt.questions[progress.revision];
  return {attemptId:progress.attemptId,expectedRevision:progress.revision,questionId:q.id,
    chosen:wrong?q.options.find(o=>o.id!==q.correctOptionId).id:q.correctOptionId,
    completedAt:progress.revision===progress.attempt.questions.length-1?completedAt:null};
}
export function advance(progress,number=1,options){
  for(let i=0;i<number;i++)progress=submitProgressAnswer(progress,command(progress,options)).progress;
  return progress;
}
