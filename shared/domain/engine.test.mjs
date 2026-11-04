import test from 'node:test';
import assert from 'node:assert/strict';
import { Phase, validatePolicy, createSession, recordUsage,
  startChallenge, submitAnswer, finishRest, rollDay } from './engine.mjs';

const policy = { periodMinutes: 30, dailyLimitMinutes: 120,
  restMinutes: 10, questionCount: 5, requiredCorrect: 5,
  grade: 3, subjects: ['chinese','math','english'] };
const ids = ['a','b','c','d','e'];
const initial = () => createSession(policy, '2026-11-04');
const challenged = () => startChallenge(recordUsage(initial(), 1800), ids);
function complete(s, withError = false) {
  return ids.reduce((current,id,index) =>
    submitAnswer(current,id,index === 0 && withError ? 'B' : 'A','A'),s);
}

test('rejects invalid policy and duplicate subjects', () => {
  assert.throws(() => validatePolicy({...policy,requiredCorrect:6}));
  assert.throws(() => validatePolicy({...policy,subjects:['math','math']}));
});
test('accumulates usage across intervals', () => {
  const partial = recordUsage(initial(),1200);
  assert.equal(partial.phase,Phase.AVAILABLE);
  const due = recordUsage(partial,600);
  assert.equal(due.phase,Phase.CHALLENGE_REQUIRED);
  assert.equal(recordUsage(due,300).dailySeconds,1800);
});
test('requires correct answers and minimum rest before releasing', () => {
  const failed = complete(challenged(),true);
  assert.equal(failed.phase,Phase.CHALLENGE_REQUIRED);
  assert.equal(failed.pendingGrant,false);
  const passed = complete(challenged());
  assert.equal(passed.phase,Phase.REST_REQUIRED);
  assert.throws(() => finishRest(passed,599));
  const released = finishRest(passed,600);
  assert.equal(released.phase,Phase.AVAILABLE);
  assert.equal(released.dailySeconds,1800);
  assert.equal(released.cycleSeconds,0);
});
test('rejects replay or out-of-order answers', () => {
  const active = challenged();
  assert.throws(() => submitAnswer(active,'b','A','A'));
  const answered = submitAnswer(active,'a','A','A');
  assert.throws(() => submitAnswer(answered,'a','A','A'));
});
test('enforces daily hard cap even if one usage report spans multiple cycles', () => {
  const s = recordUsage(initial(),8000);
  assert.equal(s.dailySeconds,7200);
  assert.equal(s.phase,Phase.DAILY_LOCKED);
  assert.equal(recordUsage(s,120).dailySeconds,7200);
});
test('day transition only advances to later day', () => {
  assert.throws(() => rollDay(initial(),'2026-11-04'));
  const next = rollDay(initial(),'2026-11-05');
  assert.equal(next.dailySeconds,0);
  assert.equal(next.dayKey,'2026-11-05');
});
