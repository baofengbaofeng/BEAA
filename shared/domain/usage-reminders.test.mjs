import test from 'node:test';
import assert from 'node:assert/strict';
import {getUsageGuidance,getUsageReminderEvent,readUsageGuidance,UsageReminderError} from './usage-reminders.mjs';
import {createGuardianLifecycle} from './guardian-lifecycle.mjs';
import {freshGuardian,step,beginGuardian,answerGuardian,finishGuardian,policy} from '../../tests/helpers/guardian-fixture.mjs';
const used=(seconds,overrides={})=>step(freshGuardian(overrides),'record_usage',{seconds});
const advance=(state,seconds)=>step(state,'record_usage',{seconds});

test('guidance derives default cycle and daily remaining from the ledger without mutating it',()=>{
 const state=freshGuardian(),before=structuredClone(state),v=getUsageGuidance(state);assert.equal(v.phase,'AVAILABLE');assert.equal(v.cycleRemainingSeconds,1800);assert.equal(v.dailyRemainingSeconds,7200);assert.equal(v.remainingUsageSeconds,1800);assert.equal(v.level,'none');assert.equal(v.usageSecondsUntilNextBoundary,1500);assert.equal(v.limitingRule,'cycle');assert.equal(v.advisoryOnly,true);assert.deepEqual(state,before);
});
test('five-minute and one-minute boundaries include their exact endpoints',()=>{
 let state=used(1499);assert.equal(getUsageGuidance(state).level,'none');assert.equal(getUsageGuidance(state).usageSecondsUntilNextBoundary,1);
 state=advance(state,1);assert.equal(getUsageGuidance(state).remainingUsageSeconds,300);assert.equal(getUsageGuidance(state).level,'five_minutes');assert.equal(getUsageGuidance(state).usageSecondsUntilNextBoundary,240);
 state=advance(state,239);assert.equal(getUsageGuidance(state).level,'five_minutes');assert.equal(getUsageGuidance(state).usageSecondsUntilNextBoundary,1);
 state=advance(state,1);assert.equal(getUsageGuidance(state).level,'one_minute');assert.equal(getUsageGuidance(state).usageSecondsUntilNextBoundary,60);
 state=advance(state,60);assert.equal(getUsageGuidance(state).level,'blocked');assert.equal(getUsageGuidance(state).remainingUsageSeconds,0);assert.equal(getUsageGuidance(state).usageSecondsUntilNextBoundary,null);
});
test('an earlier daily limit governs guidance and wins ties with the cycle',()=>{
 const earlier=getUsageGuidance(used(600,{dailyLimitMinutes:15}));assert.equal(earlier.cycleRemainingSeconds,1200);assert.equal(earlier.remainingUsageSeconds,300);assert.equal(earlier.limitingRule,'daily_limit');assert.equal(earlier.level,'five_minutes');
 assert.equal(getUsageGuidance(freshGuardian({dailyLimitMinutes:30})).limitingRule,'daily_limit');const locked=getUsageGuidance(used(1800,{dailyLimitMinutes:30}));assert.equal(locked.phase,'DAILY_LOCKED');assert.equal(locked.limitingRule,'daily_limit');
});
test('over-cap root usage survives lowered then raised policy limits',()=>{
 let state=used(1200);state=step(state,'set_policy',{policy:{...state.policy,dailyLimitMinutes:15}});let v=getUsageGuidance(state);assert.equal(v.dailyUsedSeconds,1200);assert.equal(v.dailyRemainingSeconds,0);assert.equal(v.remainingUsageSeconds,0);
 state=step(state,'set_policy',{policy:{...state.policy,dailyLimitMinutes:45}});v=getUsageGuidance(state);assert.equal(v.dailyUsedSeconds,1200);assert.equal(v.dailyRemainingSeconds,1500);assert.equal(v.remainingUsageSeconds,600);
});
test('challenge, quiz, failed quiz, rest and daily lock do not schedule usable time',()=>{
 const quiz=beginGuardian(freshGuardian());for(const state of [used(1800),quiz,answerGuardian(quiz,true),answerGuardian(quiz),used(7200)]){const v=getUsageGuidance(state);assert.equal(v.level,'blocked');assert.equal(v.remainingUsageSeconds,0);assert.equal(v.usageSecondsUntilNextBoundary,null);}
});
test('a verified new cycle resets only cycle guidance and keeps daily usage',()=>{
 const state=finishGuardian(answerGuardian(beginGuardian(freshGuardian()))),v=getUsageGuidance(state);assert.equal(v.round,1);assert.equal(v.cycleUsedSeconds,0);assert.equal(v.dailyUsedSeconds,1800);assert.equal(v.remainingUsageSeconds,1800);
});
test('calendar rollover preserves the cycle and does not itself emit reminders',()=>{
 const before=used(1500),after=step(before,'roll_day',{nextDay:'2026-11-06'});assert.equal(getUsageGuidance(after).remainingUsageSeconds,300);assert.equal(getUsageGuidance(after).dailyUsedSeconds,0);assert.equal(getUsageReminderEvent(before,after),null);
});
test('pending policy remains blocked during rest and becomes guidance only at its safe boundary',()=>{
 let state=answerGuardian(beginGuardian(freshGuardian()));state=step(state,'set_policy',{policy:{...state.policy,periodMinutes:10}});assert.equal(getUsageGuidance(state).level,'blocked');const after=finishGuardian(state);assert.equal(getUsageGuidance(after).remainingUsageSeconds,600);assert.equal(getUsageGuidance(after).dailyUsedSeconds,1800);
});
test('crossing thresholds produces deterministic distinct advisory event IDs',()=>{
 let before=used(1499),after=advance(before,1),event=getUsageReminderEvent(before,after);assert.equal(event.kind,'five_minutes');assert.equal(event.remainingSeconds,300);assert.equal(event.advisoryOnly,true);assert.deepEqual(getUsageReminderEvent(before,after),event);assert.deepEqual(JSON.parse(event.reminderId),[after.lifecycleId,after.revision,'five_minutes']);
 const firstId=event.reminderId;before=after;after=advance(before,240);event=getUsageReminderEvent(before,after);assert.equal(event.kind,'one_minute');assert.notEqual(event.reminderId,firstId);before=after;after=advance(before,60);event=getUsageReminderEvent(before,after);assert.equal(event.kind,'time_up');assert.equal(event.phase,'CHALLENGE_REQUIRED');
});
test('same snapshot, zero usage and movements inside a threshold bucket produce no extra event',()=>{
 const before=used(1500);assert.equal(getUsageReminderEvent(before,structuredClone(before)),null);assert.equal(getUsageReminderEvent(before,advance(before,0)),null);assert.equal(getUsageReminderEvent(before,advance(before,1)),null);
});
test('a large sample chooses the most urgent present boundary instead of sending stale notices',()=>{
 const initial=freshGuardian();assert.equal(getUsageReminderEvent(initial,advance(initial,1770)).kind,'one_minute');assert.equal(getUsageReminderEvent(initial,advance(initial,1800)).kind,'time_up');assert.equal(getUsageReminderEvent(initial,advance(initial,1200)),null);
});
test('daily exhaustion reports the daily guard even when both limits expire',()=>{
 const before=freshGuardian({dailyLimitMinutes:30}),event=getUsageReminderEvent(before,advance(before,1800));assert.equal(event.kind,'time_up');assert.equal(event.phase,'DAILY_LOCKED');assert.equal(event.limitingRule,'daily_limit');
});
test('a five-minute fresh cycle emits once on the first positive sample',()=>{
 const before=freshGuardian({periodMinutes:5}),after=advance(before,1);assert.equal(getUsageGuidance(before).level,'five_minutes');assert.equal(getUsageReminderEvent(before,after).kind,'five_minutes');assert.equal(getUsageReminderEvent(after,advance(after,1)),null);
});
test('a fresh cycle with only one daily minute left emits only the urgent reminder',()=>{
 let state=used(840,{periodMinutes:5,dailyLimitMinutes:15,restMinutes:0});state=step(state,'begin_quiz',{knowledgePoints:[]});state=finishGuardian(answerGuardian(state));assert.equal(getUsageGuidance(state).remainingUsageSeconds,60);const after=advance(state,1);assert.equal(getUsageReminderEvent(state,after).kind,'one_minute');assert.equal(getUsageReminderEvent(after,advance(after,1)),null);
});
test('policy edits can change visible guidance but do not create usage reminder events',()=>{
 const before=used(1200),after=step(before,'set_policy',{policy:{...before.policy,periodMinutes:25}});assert.equal(getUsageGuidance(after).level,'five_minutes');assert.equal(getUsageReminderEvent(before,after),null);
});
test('different family, skipped revisions and forged valid-shaped receipts are rejected',()=>{
 const before=freshGuardian(),after=advance(before,1500),foreign=createGuardianLifecycle('other-family',policy,'2026-11-05');assert.throws(()=>getUsageReminderEvent(foreign,after),e=>e.code==='SCOPE_MISMATCH');
 assert.throws(()=>getUsageReminderEvent(before,advance(after,1)),e=>e.code==='INVALID_TRANSITION');const forged=structuredClone(after);forged.lastReceipt.command.payload.seconds=1499;assert.throws(()=>getUsageReminderEvent(before,forged),e=>e.code==='INVALID_TRANSITION');
});
test('invalid lifecycle data is never converted into an available countdown',()=>{
 for(const value of [null,{}, {...freshGuardian(),dailyUsageSeconds:-1}, {...freshGuardian(),schemaVersion:99}])assert.throws(()=>getUsageGuidance(value),e=>e instanceof UsageReminderError&&e.code==='INVALID_LIFECYCLE');
});
test('guidance reads no local wall clock',()=>{
 const original=Date.now;try{Date.now=()=>{throw Error('wall clock must not be queried');};assert.equal(getUsageGuidance(freshGuardian()).remainingUsageSeconds,1800);}finally{Date.now=original;}
});
test('read guidance leaves a committed legacy snapshot untouched',async()=>{
 const current=freshGuardian(),{policy:ignored,dailyUsageSeconds,pendingPolicy,...old}=current,text=JSON.stringify({...old,schemaVersion:1});let reads=0;const store={read:async()=>{reads++;return text;},compareAndSwap(){throw Error('no writes');}};const v=await readUsageGuidance(store);assert.equal(reads,1);assert.deepEqual(v,getUsageGuidance(current));assert.equal(JSON.parse(text).schemaVersion,1);assert(!JSON.stringify(v).includes('correctOptionId'));
});
test('guidance and events expose no pinned answers or populated learning history',async()=>{
 const quiz=beginGuardian(freshGuardian()),completed=finishGuardian(answerGuardian(quiz));
 for(const state of [quiz,completed]){
  const text=JSON.stringify(state);assert(text.includes('correctOptionId'));
  const v=await readUsageGuidance({read:async()=>text});
  assert.deepEqual(Object.keys(v).sort(),['lifecycleId','revision','round','dayKey','phase','cycleUsedSeconds','dailyUsedSeconds','cycleRemainingSeconds','dailyRemainingSeconds','remainingUsageSeconds','limitingRule','level','usageSecondsUntilNextBoundary','advisoryOnly'].sort());
 }
 assert.equal(completed.history.records.length,1);
 const event=getUsageReminderEvent(completed,advance(completed,1500));assert.equal(event.kind,'five_minutes');
 assert.deepEqual(Object.keys(event).sort(),['reminderId','lifecycleId','revision','round','dayKey','kind','remainingSeconds','limitingRule','phase','advisoryOnly'].sort());
});
test('store errors and corrupted snapshots remain explicit without exporting private error details',async()=>{
 await assert.rejects(readUsageGuidance({}),e=>e.code==='INVALID_STORE');await assert.rejects(readUsageGuidance({read:async()=>{throw Error('private-storage-path');}}),e=>e.code==='STORE_FAILURE'&&!e.message.includes('private-storage-path'));await assert.rejects(readUsageGuidance({read:async()=>'{broken'}),e=>e.code==='INVALID_LIFECYCLE');
});
