import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession,recordUsage,finishRest,Phase } from './engine.mjs';
import { startQuiz,getCurrentQuestion,submitQuizAnswer,encodeQuizAttempt,decodeQuizAttempt } from './quiz-service.mjs';
import { createLearningHistory,recordCompletedQuiz,encodeLearningHistory,decodeLearningHistory,getLearningStats } from './learning-history.mjs';

const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,
  questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const bank=JSON.parse(readFileSync(new URL('../quiz/sample-questions.json',import.meta.url),'utf8'));
let state=recordUsage(createSession(policy,'2026-11-04'),30*60);
console.log('30分钟后:',state.phase);
let attempt=startQuiz(state,bank);
console.log('题库组卷:',attempt.questions.length,'题');
// Simulated child submissions; the service obtains its own standard answer key.
const choices={'math-g3-001':'C','math-g3-002':'B','math-g3-003':'C','chinese-g3-001':'A','english-g3-001':'C'};
function answerCurrent(current){
  const question=getCurrentQuestion(current);
  return submitQuizAnswer(current,{questionId:question.id,chosen:choices[question.id]}).attempt;
}
for(let i=0;i<2;i++)attempt=answerCurrent(attempt);
const directory=mkdtempSync(join(tmpdir(),'beaa-domain-demo-'));
try{
  const file=join(directory,'quiz.json');
  writeFileSync(file,encodeQuizAttempt(attempt,1),{mode:0o600});
  attempt=decodeQuizAttempt(readFileSync(file,'utf8')).attempt;
  console.log('测验快照恢复:',attempt.session.phase,'已答题:',attempt.session.challenge.answers.length);
  while(attempt.session.phase===Phase.CHALLENGE_ACTIVE)attempt=answerCurrent(attempt);
  console.log('答题通过:',attempt.session.phase);
  // Stable synthetic completion metadata; not a trusted device clock or event ID.
  let history=recordCompletedQuiz(createLearningHistory(),attempt,{
    attemptId:'demo-completion-1',completedAt:Date.UTC(2026,10,4,10)
  }).history;
  const historyFile=join(directory,'history.json');
  writeFileSync(historyFile,encodeLearningHistory(history,1),{mode:0o600});
  history=decodeLearningHistory(readFileSync(historyFile,'utf8')).history;
  const stats=getLearningStats(history);
  console.log('学习记录恢复:',stats.quizCount,'轮', '正确:',stats.correctCount+'/'+stats.answerCount);
  writeFileSync(file,encodeQuizAttempt(attempt,2),{mode:0o600});
  attempt=decodeQuizAttempt(readFileSync(file,'utf8')).attempt;
  // The supplied rest duration is demonstration input, not a device measurement.
  state=finishRest(attempt.session,10*60);
  console.log('休息完成:',state.phase,'今日累计秒数:',state.dailySeconds);
}finally{rmSync(directory,{recursive:true,force:true});}
