/**
 * Platform-independent BEAA rules prototype.
 * This does not inspect or restrict apps. A trusted platform adapter must
 * supply actual usage events, calendar rollover, and validated rest duration.
 */
export const Phase = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  CHALLENGE_REQUIRED: 'CHALLENGE_REQUIRED',
  CHALLENGE_ACTIVE: 'CHALLENGE_ACTIVE',
  REST_REQUIRED: 'REST_REQUIRED',
  DAILY_LOCKED: 'DAILY_LOCKED'
});

function integer(value, name, low, high) {
  if (!Number.isInteger(value) || value < low || value > high) {
    throw new RangeError(`${name}: expected integer ${low}..${high}`);
  }
}

export function validatePolicy(input) {
  if (!input || typeof input !== 'object') throw new TypeError('policy required');
  const p = structuredClone(input);
  integer(p.periodMinutes, 'periodMinutes', 5, 120);
  integer(p.dailyLimitMinutes, 'dailyLimitMinutes', 15, 600);
  integer(p.restMinutes, 'restMinutes', 0, 60);
  integer(p.questionCount, 'questionCount', 1, 20);
  integer(p.requiredCorrect, 'requiredCorrect', 1, p.questionCount);
  integer(p.grade, 'grade', 1, 6);
  const allowed = ['chinese', 'math', 'english'];
  if (!Array.isArray(p.subjects) || !p.subjects.length ||
      new Set(p.subjects).size !== p.subjects.length ||
      p.subjects.some(x => !allowed.includes(x))) throw new TypeError('invalid subjects');
  return p;
}

export function createSession(policy, dayKey) {
  const p = validatePolicy(policy);
  if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    throw new TypeError('dayKey must be YYYY-MM-DD');
  }
  return { policy: p, dayKey, phase: Phase.AVAILABLE,
    dailySeconds: 0, cycleSeconds: 0, challenge: null, pendingGrant: false };
}

export function recordUsage(s, seconds) {
  integer(seconds, 'seconds', 0, 86400);
  if (s.phase !== Phase.AVAILABLE || !seconds) return s;
  const dailyCap = s.policy.dailyLimitMinutes * 60;
  const remaining = Math.max(0, dailyCap - s.dailySeconds);
  const counted = Math.min(seconds, remaining);
  const dailySeconds = s.dailySeconds + counted;
  const cycleSeconds = s.cycleSeconds + counted;
  const phase = dailySeconds >= dailyCap ? Phase.DAILY_LOCKED :
    cycleSeconds >= s.policy.periodMinutes * 60 ?
      Phase.CHALLENGE_REQUIRED : Phase.AVAILABLE;
  return { ...s, dailySeconds, cycleSeconds, phase };
}

/** IDs must be distinct and preselected by the trusted quiz service. */
export function startChallenge(s, questionIds) {
  if (s.phase !== Phase.CHALLENGE_REQUIRED) throw new Error('challenge not required');
  if (!Array.isArray(questionIds) ||
      questionIds.length !== s.policy.questionCount ||
      questionIds.some(x => typeof x !== 'string' || !x) ||
      new Set(questionIds).size !== questionIds.length) {
    throw new Error('invalid questions');
  }
  return { ...s, phase: Phase.CHALLENGE_ACTIVE,
    challenge: { questionIds: [...questionIds], answers: [] } };
}

/**
 * The trusted quiz service must look up the answer key, rather than accept
 * an untrusted client-side claim that a response is correct.
 */
export function submitAnswer(s, questionId, chosen, expected) {
  if (s.phase !== Phase.CHALLENGE_ACTIVE || !s.challenge) {
    throw new Error('no active challenge');
  }
  const { questionIds, answers } = s.challenge;
  if (questionId !== questionIds[answers.length]) throw new Error('unexpected question');
  if (typeof chosen !== 'string' || !chosen ||
      typeof expected !== 'string' || !expected) throw new TypeError('invalid answer');
  const next = [...answers, { questionId, chosen, correct: chosen === expected }];
  const complete = next.length === questionIds.length;
  const passed = complete && next.filter(a => a.correct).length >= s.policy.requiredCorrect;
  return {
    ...s,
    challenge: { questionIds, answers: next },
    pendingGrant: passed,
    phase: !complete ? Phase.CHALLENGE_ACTIVE :
      passed ? Phase.REST_REQUIRED : Phase.CHALLENGE_REQUIRED
  };
}

/** verifiedSeconds must come from a trusted clock/rest monitor, not a UI button. */
export function finishRest(s, verifiedSeconds) {
  if (s.phase !== Phase.REST_REQUIRED || !s.pendingGrant) {
    throw new Error('no pending rest');
  }
  integer(verifiedSeconds, 'verifiedSeconds', 0, 86400);
  if (verifiedSeconds < s.policy.restMinutes * 60) throw new Error('rest not complete');
  if (s.dailySeconds >= s.policy.dailyLimitMinutes * 60) {
    return { ...s, phase: Phase.DAILY_LOCKED, pendingGrant: false };
  }
  return { ...s, phase: Phase.AVAILABLE, cycleSeconds: 0,
    challenge: null, pendingGrant: false };
}

/** Only a trusted calendar service may request a day rollover. */
export function rollDay(s, nextDay) {
  if (typeof nextDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(nextDay) ||
      nextDay <= s.dayKey) throw new Error('invalid next day');
  return { ...s, dayKey: nextDay, phase: Phase.AVAILABLE,
    dailySeconds: 0, cycleSeconds: 0, pendingGrant: false, challenge: null };
}
