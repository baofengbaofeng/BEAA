import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../apps/web-preview/index.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'embedded preview script exists');
const script = match[1];

function harness() {
  let handler;
  const storage = new Map();
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
    questionCount: { value: '5' }
  };
  const document = {
    getElementById(id) { return elements[id] || fields[id]; },
    addEventListener(name, callback) {
      if (name === 'click') handler = callback;
    }
  };
  class MockDate extends Date { static now() { return now; } }
  const localStorage = {
    getItem(k) { return storage.get(k) ?? null; },
    setItem(k, v) { storage.set(k, v); }
  };
  const context = vm.createContext({
    document,
    localStorage,
    Date: MockDate,
    confirm: () => true,
    console
  });
  vm.runInContext(script, context);
  const click = (dataset) => handler({ target: { closest: () => ({ dataset }) } });
  const action = id => click({ action: id });
  const answer = index => click({ answer: String(index) });
  const current = () => JSON.parse(storage.get('beaa-web-preview-v1'));
  return {
    action, answer, current,
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

test('daily cap remains locked, even when extra time is attempted', () => {
  const h = harness();
  h.fields.dailyLimit.value = '30';
  h.action('saveSettings');
  h.action('fill');
  assert.equal(h.current().phase, 'daily');
  h.action('use');
  assert.equal(h.current().dailyUsed, 30);
  h.action('start');
  assert.equal(h.current().phase, 'daily');
});

test('settings are stored locally and malformed storage does not crash', () => {
  const h = harness();
  h.fields.period.value = '25';
  h.action('saveSettings');
  assert.equal(h.current().period, 25);
  assert.doesNotThrow(() => vm.runInContext(script.replaceAll('const STORAGE=', 'const STORAGE_NEW='), vm.createContext({
    document: {getElementById: id => ({innerHTML:''}),addEventListener:()=>{}},
    localStorage:{getItem:()=>'{broken',setItem:()=>{}},
    Date,
    confirm:()=>true,
    console
  })));
});
