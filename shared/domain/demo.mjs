import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession,recordUsage,startChallenge,submitAnswer,finishRest } from './engine.mjs';
import { encodeSession,decodeSession } from './snapshot.mjs';

const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,
  questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
let state=recordUsage(createSession(policy,'2026-11-04'),30*60);
console.log('30分钟后:',state.phase);
const questionIds=['1','2','3','4','5'];
state=startChallenge(state,questionIds);
for(const id of questionIds.slice(0,2))state=submitAnswer(state,id,'C','C');
const directory=mkdtempSync(join(tmpdir(),'beaa-domain-demo-'));
try{
  const file=join(directory,'session.json');
  writeFileSync(file,encodeSession(state,1),{mode:0o600});
  state=decodeSession(readFileSync(file,'utf8')).session;
  console.log('磁盘快照恢复:',state.phase,'已答题:',state.challenge.answers.length);
  for(const id of questionIds.slice(state.challenge.answers.length))state=submitAnswer(state,id,'C','C');
  console.log('答题通过:',state.phase);
  writeFileSync(file,encodeSession(state,2),{mode:0o600});
  state=decodeSession(readFileSync(file,'utf8')).session;
  console.log('休息阶段快照恢复:',state.phase);
  // These supplied usage/rest values are demonstration inputs, not device measurements.
  state=finishRest(state,10*60);
  console.log('休息完成:',state.phase,'今日累计秒数:',state.dailySeconds);
}finally{rmSync(directory,{recursive:true,force:true});}
