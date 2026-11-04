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

/** Calendar format only; authorization to advance a day belongs to the caller. */
export function validateDayKey(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError('dayKey must be a valid YYYY-MM-DD date');
  const [,yearText,monthText,dayText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const leap = year % 400 === 0 || year % 4 === 0 && year % 100 !== 0;
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month-1]) {
    throw new TypeError('dayKey must be a valid YYYY-MM-DD date');
  }
  return value;
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
      Array.from(p.subjects).some(x => !allowed.includes(x))) throw new TypeError('invalid subjects');
  return p;
}

export function createSession(policy, dayKey) {
  const p = validatePolicy(policy);
  validateDayKey(dayKey);
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
      Array.from(questionIds).some(x => typeof x !== 'string' || !x) ||
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
  validateDayKey(nextDay);
  validateDayKey(s.dayKey);
  if (nextDay <= s.dayKey) throw new Error('invalid next day');
  // Calendar rollover removes only the daily guard. It is not a rest or quiz event.
  let phase = s.phase;
  let pendingGrant = s.pendingGrant;
  if (s.phase === Phase.DAILY_LOCKED) {
    phase = s.cycleSeconds >= s.policy.periodMinutes * 60 ? Phase.CHALLENGE_REQUIRED : Phase.AVAILABLE;
    if (s.challenge) {
      const { questionIds, answers } = s.challenge;
      const complete = answers.length === questionIds.length;
      const passed = complete && answers.filter(answer => answer.correct).length >= s.policy.requiredCorrect;
      phase = !complete ? Phase.CHALLENGE_ACTIVE : passed ? Phase.REST_REQUIRED : Phase.CHALLENGE_REQUIRED;
    }
    // Calendar rollover cannot certify rest: retained grants require trusted rest evidence.
    pendingGrant = phase === Phase.REST_REQUIRED;
  }
  return { ...s, dayKey: nextDay, phase, dailySeconds: 0, pendingGrant };
}
