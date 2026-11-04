import { createSession, recordUsage, startChallenge,
  submitAnswer, finishRest } from './engine.mjs';

const policy = { periodMinutes: 30, dailyLimitMinutes: 120,
  restMinutes: 10, questionCount: 5, requiredCorrect: 5,
  grade: 3, subjects: ['chinese','math','english'] };
let state = createSession(policy,'2026-11-04');
state = recordUsage(state,30*60);
console.log('30分钟后:',state.phase);
const questionIds = ['1','2','3','4','5'];
state = startChallenge(state,questionIds);
for (const id of questionIds) state = submitAnswer(state,id,'C','C');
console.log('答题通过:',state.phase);
state = finishRest(state,10*60);
console.log('休息完成:',state.phase,'今日累计秒数:',state.dailySeconds);
