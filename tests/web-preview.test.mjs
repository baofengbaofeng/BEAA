import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('../apps/web-preview/index.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'embedded preview script exists');
const script = match[1];

export function harness(initial = null, storageFails = false, readHook = null, initialNow = 1_000_000) {
  let handler;
  const storage = new Map(initial ? [['beaa-web-preview-v1', JSON.stringify(initial)]] : []);
  let now = initialNow;
  const elements = {
    app: { innerHTML: '' },
    nav: { innerHTML: '' }
  };
  const fields = {
    period: { value: '30' },
    dailyLimit: { value: '120' },
    rest: { value: '10' },
    grade: { value: '3' },
    questionCount: { value: '5' }, requiredCorrect:{value:'5'}, subject:{value:'all'}, topic:{value:'all'}
  };
  const document = {
    getElementById(id) { return elements[id] || fields[id]; },
    addEventListener(name, callback) {
      if (name === 'click') handler = callback;
    }
  };
  class MockDate extends Date { static now() { return now; } }
  const localStorage = {
    getItem(k) { return readHook ? readHook(storage,k) : storage.get(k) ?? null; },
    setItem(k, v) { if(storageFails) throw new Error('quota'); storage.set(k, v); }
  };
  const context = vm.createContext({
    document,
    crypto: webcrypto, TextEncoder, Uint8Array,
    localStorage,
    Date: MockDate,
    confirm: () => true,
    console
  });
  vm.runInContext(script, context);
  const click = (dataset) => handler({ target: { closest: () => ({ dataset }) } });
  const action = id => click({ action: id });
  const answer = index => {const state=current();return click({ answer:String(index),question:state.activeQuestions?.[state.question]?.id });};
  const current = () => JSON.parse(storage.get('beaa-web-preview-v1'));
  return {
    action, answer, current,
    navigate: page => click({page}),
    evaluate: code => vm.runInContext(code, context),
    async parent() { fields.pin={value:'839271'}; fields.pinConfirm={value:'839271'}; await action('unlock'); },
    fields, storage, context,
    advance(ms) { now += ms; },
    page: () => elements.app.innerHTML,
    nav: () => elements.nav.innerHTML
  };
}

test('browser preview includes responsive layout and honest disclaimer', () => {
  assert.match(html, /@media\(max-width:760px\)/);
  assert.match(html, /不具备设备管控权限/);
  assert.match(html, /不能限制其他应用/);
  assert.match(html, /lang="zh-CN"/);
});

test('timer triggers challenge and wrong answer does not advance', () => {
  const h = harness();
  h.action('fill');
  assert.equal(h.current().phase, 'challenge');
  h.action('start');
  assert.equal(h.current().phase, 'answering');
  h.answer(0);
  assert.equal(h.current().question, 0);
  assert.match(h.page(), /再想一想/);
  h.answer(2);
  assert.equal(h.current().question, 1);
});

test('all correct answers require minimum rest before next cycle', () => {
  const h = harness();
  h.action('fill');
  h.action('start');
  [2,1,0,2,2].forEach(i => h.answer(i));
  assert.equal(h.current().phase, 'rest');
  assert.equal(h.current().question, 5);
  h.action('rest');
  assert.equal(h.current().phase, 'rest');
  h.advance(10*60*1000);
  h.action('rest');
  assert.equal(h.current().phase, 'available');
  assert.equal(h.current().cycleUsed, 0);
  assert.equal(h.current().dailyUsed, 30);
});

test('daily cap remains locked, even when extra time is attempted', async () => {
  const h = harness();
  await h.parent();
  h.fields.dailyLimit.value = '30';
  h.action('saveSettings');
  h.action('fill');
  assert.equal(h.current().phase, 'daily');
  h.action('use');
  assert.equal(h.current().dailyUsed, 30);
  h.action('start');
  assert.equal(h.current().phase, 'daily');
});

test('settings are stored locally and malformed storage does not crash', async () => {
  const h = harness();
  await h.parent();
  h.fields.period.value = '25';
  h.action('saveSettings');
  assert.equal(h.current().period, 25);
  assert.doesNotThrow(() => vm.runInContext(script, vm.createContext({
    document: {getElementById: id => ({innerHTML:''}),addEventListener:()=>{}},
    localStorage:{getItem:()=>'{broken',setItem:()=>{}},
    Date,
    confirm:()=>true,
    console
  })));
});


test('unauthorized settings and reset are rejected', () => {
  const h=harness(); h.fields.period.value='5'; h.action('saveSettings');
  assert.equal(h.current().period,30);
  h.action('fill'); h.action('reset'); assert.equal(h.current().dailyUsed,30);
});

test('completed rest progress survives reload without truncation', () => {
  const h=harness(); h.action('fill'); h.action('start'); [2,1,0,2,2].forEach(h.answer);
  const resumed=harness(h.current()); assert.equal(resumed.current().question,5);
  assert.equal(resumed.current().phase,'rest');
});

test('storage failure is visible and does not crash interactions', () => {
  const h=harness(null,true); assert.doesNotThrow(()=>h.action('fill'));
  assert.match(h.page(),/无法保存/);
});

test('invalid stored phase and forged incomplete grant cannot render a reward', () => {
  const h=harness({phase:'rest',question:0,correct:0,restStart:1,page:'success'});
  assert.notEqual(h.evaluate('s.phase'),'rest'); assert.doesNotMatch(h.page(),/获得下一轮/);
});

test('wrong first answers create review and a failed challenge without a grant', () => {
  const h=harness(); h.action('fill'); h.action('start'); h.answer(0);
  [2,1,0,2,2].forEach(h.answer);
  assert.equal(h.current().phase,'challenge');
  assert.equal(h.current().history[0].passed,false);
  assert.equal(h.current().mistakes.length,1);
});

test('grade subject and topic filter actual questions and reject insufficient pools', async () => {
  const h=harness(); await h.parent();
  h.fields.grade.value='1'; h.fields.subject.value='math'; h.fields.topic.value='arithmetic';
  h.action('saveSettings'); h.action('fill'); h.action('start');
  assert.equal(h.current().activeQuestions.length,5);
  for(const q of h.current().activeQuestions) { assert.equal(q.grade,1); assert.equal(q.subject,'math'); }
});

test('changing settings during a challenge is rejected', async () => {
  const h=harness(); await h.parent(); h.action('fill'); h.action('start');
  h.fields.questionCount.value='1'; h.action('saveSettings'); assert.equal(h.current().questionCount,5);
});

test('PIN is hashed, wrong PIN rejected, cooldown and reload require authentication', async () => {
 const h=harness();await h.parent();assert.ok(h.current().pinHash);assert.equal(JSON.stringify(h.current()).includes('839271'),false);
 const r=harness(h.current());r.fields.period.value='5';r.action('saveSettings');assert.equal(r.current().period,30);
 r.fields.pin={value:'000000'};for(let i=0;i<5;i++)await r.action('unlock');
 r.fields.pin.value='839271';await r.action('unlock');r.action('saveSettings');assert.equal(r.current().period,30);
 r.advance(60001);await r.action('unlock');r.action('saveSettings');assert.equal(r.current().period,5);
 r.advance(5*60000+1);r.fields.period.value='10';r.action('saveSettings');assert.equal(r.current().period,5);
});

test('import rejects malformed banks and HTML is escaped in rendered questions', async () => {
 const h=harness();await h.parent();h.fields.bank={value:JSON.stringify([{id:'x'}])};h.action('import');assert.equal(h.current().bank.length,0);
 const q={id:'x',grade:3,subject:'math',topic:'arithmetic',text:'<svg onload=alert(1)>',options:['yes','no'],answer:0,explain:'safe'};
 h.fields.bank.value=JSON.stringify([q,q]);h.action('import');assert.equal(h.current().bank.length,0);
 h.fields.bank.value=JSON.stringify([q]);h.action('import');assert.equal(h.current().bank.length,1);
 h.fields.questionCount.value='1';h.action('saveSettings');h.action('fill');h.action('start');assert.match(h.page(),/&lt;svg/);assert.doesNotMatch(h.page(),/<svg/);
});

test('insufficient pool does not start a challenge', async () => {
 const h=harness();await h.parent();h.fields.questionCount.value='20';h.fields.subject.value='english';h.fields.grade.value='1';h.action('saveSettings');h.action('fill');h.action('start');
 assert.equal(h.current().phase,'challenge');assert.match(h.page(),/题目不足/);
});

test('daily rollover resets only daily usage and a clock rollback cannot complete rest', () => {
 const h=harness();h.action('fill');h.action('start');[2,1,0,2,2].forEach(h.answer);h.advance(-1000);h.action('rest');assert.equal(h.current().phase,'rest');assert.match(h.page(),/时间回拨/);
 h.advance(86400000);h.action('rest');assert.equal(h.current().dailyUsed,0);assert.equal(h.current().phase,'available');
});

test('stale question button cannot answer the following question', () => {
 const h=harness();h.action('fill');h.action('start');[2,1,0].forEach(h.answer);
 const stale=h.current().activeQuestions[3].id;h.answer(2);
 h.evaluate(`choose(2, ${JSON.stringify(stale)})`);
 assert.equal(h.current().question,4);
});

test('invalid persisted answering phase cannot grant already exhausted daily allowance', () => {
 const h=harness({...harness().current(),phase:'answering',dailyUsed:120,page:'home'});assert.equal(h.evaluate('s.phase'),'daily');h.navigate('home');h.action('start');assert.equal(h.current().phase,'daily');
});

test('corrupt optional records never erase PIN or daily allowance', async () => {
 const h=harness();await h.parent();h.action('fill');
 for(const extra of [{mistakes:[null]},{history:[null]},{audit:[null]},{bank:[{id:'invalid'}]}]){
  const resumed=harness({...h.current(),...extra});assert.equal(resumed.current().pinHash,h.current().pinHash);assert.equal(resumed.current().dailyUsed,30);
 }
});

test('an older tab cannot overwrite a newer daily lock on navigation', () => {
 const a=harness();const old=a.current();a.action('fill');const newer={...a.current(),dailyUsed:120,phase:'daily'};
 const stale=harness(old);stale.storage.set('beaa-web-preview-v1',JSON.stringify(newer));stale.navigate('home');
 assert.equal(stale.current().dailyUsed,120);assert.equal(stale.current().phase,'daily');
});

test('a state change during PIN hashing cannot authorize a mismatched credential pair', async () => {
 const h=harness();h.fields.pin={value:'839271'};h.fields.pinConfirm={value:'839271'};
 h.evaluate("let resolvePin;pinDigest=()=>new Promise(r=>resolvePin=r)");const pending=h.action('unlock');
 h.storage.set('beaa-web-preview-v1',JSON.stringify({...h.current(),lastTime:2000000}));h.evaluate('syncState()');h.evaluate("resolvePin('a'.repeat(64))");await pending;
 assert.equal(h.evaluate('parentUntil'),0);assert.equal(h.current().pinHash,null);assert.equal(h.current().pinSalt,null);
});


test('initialization binds state and version to the same raw storage snapshot',async()=>{
 const parent=harness();await parent.parent();parent.action('fill');const committed=parent.current();
 const older={...committed,pinHash:null,pinSalt:null,dailyUsed:0,cycleUsed:0,phase:'available'};
 let first=true;
 const resumed=harness(older,false,(storage,key)=>{
  if(first){first=false;const value=storage.get(key);storage.set(key,JSON.stringify(committed));return value;}
  return storage.get(key) ?? null;
 });
 assert.equal(resumed.evaluate('s.pinHash'),committed.pinHash);
 assert.equal(resumed.evaluate('s.dailyUsed'),30);
 assert.equal(resumed.current().pinHash,committed.pinHash);
 resumed.navigate('home');
 assert.equal(resumed.current().pinHash,committed.pinHash);
 assert.equal(resumed.current().dailyUsed,30);
});

test('temporary use requires parent validation, remains within current allowance and records audit',async()=>{
 const h=harness();h.fields.permitMinutes={value:'5'};h.action('issuePermit');assert.equal(h.current().permit??null,null);
 await h.parent();h.action('issuePermit');assert.equal(h.current().permit.budgetSeconds,300);assert.equal(h.current().audit.at(-1).type,'permit_issue');
 h.action('use');assert.equal(h.current().dailyUsed,5);assert.equal(h.current().cycleUsed,5);assert.equal(h.current().permit.closedReason,'budget_exhausted');
 h.action('use');assert.equal(h.current().dailyUsed,5);h.action('endPermit');h.action('use');assert.equal(h.current().dailyUsed,15);
});
test('temporary expiry survives reload, requires parent action and cannot bypass rest or daily cap',async()=>{
 const h=harness();await h.parent();h.fields.permitMinutes={value:'1'};h.action('issuePermit');h.advance(60000);h.action('use');assert.equal(h.current().dailyUsed,0);assert.equal(h.current().permit.closedReason,'expired');
 const resumed=harness(h.current());resumed.advance(60000);resumed.action('use');assert.equal(resumed.current().dailyUsed,0);resumed.action('endPermit');assert.notEqual(resumed.current().permit,null);
 await resumed.parent();resumed.action('endPermit');resumed.action('fill');resumed.action('start');[2,1,0,2,2].forEach(resumed.answer);resumed.fields.permitMinutes={value:'5'};resumed.action('issuePermit');assert.equal(resumed.current().permit,null);assert.equal(resumed.current().phase,'rest');
 const locked=harness({...h.current(),permit:null,dailyUsed:120,phase:'daily'});locked.advance(60000);await locked.parent();locked.fields.permitMinutes={value:'1'};locked.action('issuePermit');assert.equal(locked.current().permit,null);assert.equal(locked.current().dailyUsed,120);
});
test('temporary access rejects excess daily allowance and closes permanently on clock rollback',async()=>{
 const h=harness();await h.parent();h.fields.dailyLimit.value='15';h.action('saveSettings');h.action('use');h.fields.permitMinutes={value:'6'};h.action('issuePermit');assert.equal(h.current().permit,null);
 h.fields.permitMinutes.value='5';h.action('issuePermit');h.advance(-1);h.action('use');assert.equal(h.current().permit.closedReason,'clock_rollback');h.advance(2);h.action('use');assert.equal(h.current().dailyUsed,10);
});
test('one-minute simulation exposes urgent page reminders and a daily cap wins ties',()=>{
 const h=harness();for(let i=0;i<25;i++)h.action('useOne');assert.equal(h.current().dailyUsed,25);assert.match(h.page(),/剩余 5 分钟/);
 for(let i=0;i<4;i++)h.action('useOne');assert.match(h.page(),/剩余 1 分钟/);h.action('useOne');assert.equal(h.current().phase,'challenge');assert.doesNotMatch(h.page(),/本轮剩余时间<\/div><div class="big">30/);
});
test('broken critical snapshots remain untouched and never accept usage or parent setup',async()=>{
 const seed=harness();seed.action('fill');const original=seed.current();
 for(const extra of [{dailyUsed:-1},{cycleUsed:'0'},{phase:'unknown'},{pinHash:'invalid',pinSalt:'x'},{day:'2026-99-99'},{permit:{invalid:true}}]){
  const h=harness({...original,...extra}),before=h.storage.get('beaa-web-preview-v1');h.action('fill');await h.parent();assert.equal(h.storage.get('beaa-web-preview-v1'),before);assert.match(h.page(),/数据需要恢复/);
 }
 const broken=harness(null,false,()=>'{broken');broken.action('fill');await broken.parent();assert.equal(broken.storage.size,0);assert.match(broken.page(),/数据需要恢复/);
});
test('a storage write failure cannot return a new in-memory usage grant',()=>{
 const h=harness(null,true);h.action('fill');h.action('use');assert.equal(h.evaluate('s.dailyUsed'),0);assert.match(h.page(),/无法保存/);
});
test('a daily rollover preserves an exhausted cycle and still requires a challenge',()=>{
 const h=harness();h.action('fill');const locked=harness({...h.current(),dailyLimit:30,dailyUsed:30,phase:'daily'});locked.advance(86400000);locked.action('use');assert.equal(locked.current().dailyUsed,0);assert.equal(locked.current().cycleUsed,30);assert.equal(locked.current().phase,'challenge');
});
test('learning summary excludes credentials and audit details survive a normal reload',async()=>{
 const h=harness();await h.parent();h.fields.permitMinutes={value:'2'};h.action('issuePermit');const summary=JSON.parse(h.evaluate('JSON.stringify(learningSummary())'));assert.equal(summary.deviceControlValidated,false);assert.equal(summary.simulated,true);assert(!JSON.stringify(summary).match(/pinHash|pinSalt|839271/));
 const next=harness(h.current());assert.equal(next.current().audit.at(-1).minutes,2);await next.parent();next.navigate('settings');assert.match(next.page(),/临时时段分配/);
});

test('startup-observed expiry and rollback are committed and cannot revive after reload',async()=>{
 const h=harness();await h.parent();h.fields.permitMinutes={value:'5'};h.action('issuePermit');const original=h.current();
 for(const [now,reason] of [[1300001,'expired'],[999999,'clock_rollback']]){
  const observed=harness(original,false,null,now);assert.equal(observed.current().permit.closedReason,reason);
  const reopened=harness(observed.current(),false,null,1060000);reopened.action('useOne');assert.equal(reopened.current().dailyUsed,0);assert.equal(reopened.current().permit.closedReason,reason);
 }
 const failed=harness(original,true,null,1300001);failed.action('useOne');assert.equal(failed.current().dailyUsed,0);assert.match(failed.page(),/无法保存/);
});
test('a delayed one-minute permit can consume bounded seconds and preserve them on reload',async()=>{
 const h=harness();await h.parent();h.fields.permitMinutes={value:'1'};h.action('issuePermit');h.advance(1001);h.action('useOne');assert.equal(h.current().dailyUsed,0);assert.equal(h.current().dailyRemainderSeconds,58);assert.equal(h.current().cycleRemainderSeconds,58);assert.equal(h.current().permit.usedSeconds,58);
 const reopened=harness(h.current(),false,null,1001001);assert.equal(reopened.current().dailyRemainderSeconds,58);reopened.action('useSecond');assert.equal(reopened.current().dailyRemainderSeconds,59);assert.equal(reopened.current().permit.usedSeconds,59);
});

test('native reminder snapshots use committed revisions and cycle sequence without exposing private data',()=>{
 const h=harness(),sent=[],pauses=[];h.context.window={beaaNative:{updateReminderState:text=>{sent.push(JSON.parse(text));return 'accepted';},pauseReminders:()=>{pauses.push(true);return 'accepted';}}};
 h.evaluate('pushNativeReminder()');const initial=sent.at(-1);assert.equal(initial.scopeId,'web-preview');assert.equal(initial.simulated,true);assert.equal(initial.phase,'AVAILABLE');assert.equal(initial.revision,h.current().stateRevision);assert(!JSON.stringify(initial).match(/pinHash|pinSalt|correctOptionId/));
 h.action('useOne');assert(sent.at(-1).revision>initial.revision);const source=h.current();assert.equal(sent.at(-1).cycleRemainingSeconds,1740);const resumed=harness(source);assert.equal(resumed.current().stateRevision,source.stateRevision);
});
test('native simulation cycle IDs survive history retention and failed writes only pause notifications',()=>{
 const h=harness();h.action('fill');h.action('start');[2,1,0,2,2].forEach(h.answer);h.advance(600000);h.action('rest');assert.equal(h.current().cycleSequence,1);
 const failed=harness(null,true),sent=[],paused=[];failed.context.window={beaaNative:{updateReminderState:t=>{sent.push(t);return 'accepted';},pauseReminders:()=>{paused.push(true);return 'accepted';}}};failed.evaluate('pushNativeReminder()');assert.equal(sent.length,0);assert.equal(paused.length,1);
});
test('parent demo reset keeps monotonic native notification revisions and starts a fresh cycle identity',async()=>{
 const h=harness();await h.parent();h.action('useOne');const before=h.current();h.action('reset');assert(h.current().stateRevision>before.stateRevision);assert(h.current().cycleSequence>before.cycleSequence);assert.equal(h.current().dailyUsed,0);
});
