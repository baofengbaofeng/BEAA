import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const html = readFileSync(new URL('../apps/web-preview/index.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'embedded preview script exists');
const script = match[1];

export function harness(initial = null, storageFails = false, readHook = null) {
  let handler;
  const storage = new Map(initial ? [['beaa-web-preview-v1', JSON.stringify(initial)]] : []);
  let now = 1_000_000;
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
 const h=harness({phase:'answering',dailyUsed:120,page:'home'});assert.equal(h.evaluate('s.phase'),'daily');h.navigate('home');h.action('start');assert.equal(h.current().phase,'daily');
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
