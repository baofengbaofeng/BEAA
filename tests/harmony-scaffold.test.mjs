import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../apps/harmony/', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('native application scaffold has required entry and resources', () => {
  for (const file of [
    'AppScope/app.json5', 'entry/src/main/module.json5',
    'entry/src/main/ets/entryability/EntryAbility.ets',
    'entry/src/main/ets/pages/Index.ets',
    'entry/src/main/resources/base/profile/main_pages.json',
    'entry/src/main/resources/base/element/string.json'
  ]) assert.equal(existsSync(new URL(file,root)), true, file);
});

test('UI demo includes four required flows and responsive layout', () => {
  const page = read('entry/src/main/ets/pages/Index.ets');
  for (const marker of [
    'GridRow', 'BreakpointsReference.WindowSize', '今天也要健康用屏',
    '学习挑战', '挑战成功', '家长设置', '休息一下',
    '模拟使用时间到期', '不具备系统锁定功能'
  ]) assert.ok(page.includes(marker), marker);
});

test('page route and app name are consistent', () => {
  const pages = JSON.parse(read('entry/src/main/resources/base/profile/main_pages.json'));
  const strings = JSON.parse(read('entry/src/main/resources/base/element/string.json'));
  assert.ok(pages.src.includes('pages/Index'));
  assert.equal(strings.string.find(s => s.name === 'app_name')?.value, '学知守护');
});
