/** Foreground PRACTICE only. This state never proves OS usage, rest, or device enforcement. */
export interface NativeQuestion { id: string; prompt: string; expected: number; firstAnswer: string | null }
export interface NativeRound { id: number; questions: NativeQuestion[]; completed: boolean; granted: boolean }
export interface NativeGrant { roundId: number; seconds: number; source: 'foreground-practice' }
export interface NativeLearningState {
  source: 'foreground-practice'; day: number; used: number; available: number; cycleUsed: number;
  restRemaining: number; nextRound: number; round: NativeRound | null; grants: NativeGrant[];
}
export function initialLearning(): NativeLearningState { return {source:'foreground-practice',day:0,used:0,available:0,cycleUsed:0,restRemaining:0,nextRound:1,round:null,grants:[]}; }
function integer(n: number): boolean { return Number.isSafeInteger(n) && n>=0; }
export function validateLearning(s: NativeLearningState): void {
  if (!s || s.source!=='foreground-practice' || ![s.day,s.used,s.available,s.cycleUsed,s.restRemaining,s.nextRound].every(integer) || s.used+s.available>7200 || s.cycleUsed>1800 || s.restRemaining>600 || s.nextRound<1 || !Array.isArray(s.grants)) throw Error('Invalid learning state');
  let total=0; const seen: number[]=[];
  for(const g of s.grants) { if(!g || g.source!=='foreground-practice' || !integer(g.roundId)||g.roundId<1||g.roundId>=s.nextRound||seen.includes(g.roundId)||g.seconds!==1800)throw Error('Invalid grant provenance');seen.push(g.roundId);total+=g.seconds; }
  if(total!==s.used+s.available || total>7200)throw Error('Invalid learning accounting');
  if(s.available>1800 || s.cycleUsed>s.used || (s.cycleUsed!==s.used%1800 && !(s.cycleUsed===1800 && s.used>0 && s.used%1800===0)) || (s.restRemaining>0 && (s.cycleUsed!==1800 || s.available!==0)))throw Error('Invalid practice cycle');
  const r=s.round;
  if(r!==null) {
    if(!r||!integer(r.id)||r.id!==s.nextRound-1||typeof r.completed!=='boolean'||typeof r.granted!=='boolean'||!Array.isArray(r.questions)||r.questions.length!==3)throw Error('Invalid round');
    const expected=questions(r.id);
    r.questions.forEach((q,i)=>{if(!q||q.id!==expected[i].id||q.prompt!==expected[i].prompt||q.expected!==expected[i].expected||(q.firstAnswer!==null&&(typeof q.firstAnswer!=='string'||q.firstAnswer.length>32)))throw Error('Invalid immutable question');});
    if(r.completed!==r.questions.every(q=>q.firstAnswer!==null)||r.granted!==seen.includes(r.id)||(r.granted&&!r.questions.every(correct))||(r.completed&&r.questions.every(correct)&&!r.granted))throw Error('Invalid round outcome');
  }
}
function questions(id: number): NativeQuestion[] {
  // Explicitly bounded arithmetic subset; no web answer checker or arbitrary expression evaluation.
  const a=id%9+1,b=(id*3)%9+1;
  return [{id:id+'-1',prompt:a+' + '+b+' = ?',expected:a+b,firstAnswer:null},{id:id+'-2',prompt:(a+b)+' − '+a+' = ?',expected:b,firstAnswer:null},{id:id+'-3',prompt:a+' × '+b+' = ?',expected:a*b,firstAnswer:null}];
}
function correct(q: NativeQuestion): boolean { return q.firstAnswer!==null && /^(0|[1-9]\d*)$/.test(q.firstAnswer.trim()) && Number(q.firstAnswer.trim())===q.expected; }
export function startRound(s: NativeLearningState): NativeRound {
  if(s.restRemaining>0||s.available>0||s.used>=7200||(s.round&&!s.round.completed))throw Error('Practice round unavailable');
  const r: NativeRound={id:s.nextRound++,questions:questions(s.nextRound-1),completed:false,granted:false};s.round=r;return r;
}
export function answerOnce(s: NativeLearningState,roundId: number,questionId: string,answer: string): void {
  const r=s.round;if(!r||r.id!==roundId||r.completed||typeof answer!=='string'||answer.length>32)throw Error('Round answer rejected');
  const q=r.questions.find(item=>item.id===questionId);if(!q||q.firstAnswer!==null)throw Error('First answer is immutable');
  q.firstAnswer=answer;r.completed=r.questions.every(item=>item.firstAnswer!==null);
  if(r.completed&&r.questions.every(correct)) {if(s.available!==0||s.restRemaining!==0||s.used+1800>7200)throw Error('Practice budget exceeded');s.available+=1800;r.granted=true;s.grants.push({roundId:r.id,seconds:1800,source:'foreground-practice'});}
}
/** Only consecutive visible callbacks of <=3 seconds count. Suspension gaps earn nothing. */
export function practiceQuantum(s: NativeLearningState,seconds: number,rest: boolean): void {
  if(!integer(seconds)||seconds<1||seconds>3)throw Error('Invalid foreground quantum');
  if(rest) {if(s.restRemaining===0)throw Error('No practice rest pending');s.restRemaining=Math.max(0,s.restRemaining-seconds);if(s.restRemaining===0)s.cycleUsed=0;return;}
  if(s.restRemaining>0||s.available===0)throw Error('Practice qualification required');
  const consumed=Math.min(seconds,s.available,1800-s.cycleUsed);s.available-=consumed;s.used+=consumed;s.cycleUsed+=consumed;
  if(s.cycleUsed===1800)s.restRemaining=600;
}
