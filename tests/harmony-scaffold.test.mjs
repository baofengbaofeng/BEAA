import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import JSON5 from 'json5';

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

test('native offline entry uses the same tested responsive page with a narrow summary export bridge', () => {
  const page=read('entry/src/main/ets/pages/Index.ets');
  assert.match(page,/Web\(/);assert.match(page,/\$rawfile\('beaa-preview.html'\)/);assert.match(page,/domStorageAccess\(true\)/);
  assert.match(page,/javaScriptProxy/);assert.match(page,/exportLearningSummary/);assert.doesNotMatch(page,/restrictApps|releaseApps|setPolicy|verifyPin/);
  const embedded=read('entry/src/main/resources/rawfile/beaa-preview.html');
  assert.equal(embedded,readFileSync(new URL('../apps/web-preview/index.html',import.meta.url),'utf8'));
  for(const marker of ['@media(max-width:760px)','学习挑战','家长设置','检查休息条件','不具备设备管控权限'])assert.ok(embedded.includes(marker),marker);
});

test('page route and app name are consistent', () => {
  const pages = JSON.parse(read('entry/src/main/resources/base/profile/main_pages.json'));
  const strings = JSON.parse(read('entry/src/main/resources/base/element/string.json'));
  assert.ok(pages.src.includes('pages/Index'));
  assert.equal(strings.string.find(s => s.name === 'app_name')?.value, '学知守护');
});

test('module targets reference products declared in the app build profile', () => {
  const profile=JSON5.parse(read('build-profile.json5'));
  assert.ok(Array.isArray(profile.app.products),'product declarations must be under app.products');
  assert.equal(Object.hasOwn(profile,'products'),false,'root-level products are not app products');
  const products=new Set(profile.app.products.map(p=>p.name));
  assert.equal(products.size,profile.app.products.length,'product names must be unique');
  assert.ok(products.has('default'));
  for(const module of profile.modules){
    assert.ok(existsSync(new URL(`${module.srcPath}/build-profile.json5`,root)));
    const moduleProfile=JSON5.parse(read(`${module.srcPath}/build-profile.json5`));
    const targets=new Set(moduleProfile.targets.map(target=>target.name));
    for(const target of module.targets){
      assert.ok(targets.has(target.name),`unknown module target ${target.name}`);
      for(const product of target.applyToProducts)assert.ok(products.has(product),`unknown product ${product}`);
    }
  }
});

test('application metadata resolves its label and icon inside AppScope', () => {
  const {app}=JSON5.parse(read('AppScope/app.json5'));
  const labelName=app.label.match(/^\$string:(\w+)$/)?.[1];
  const iconName=app.icon.match(/^\$media:(\w+)$/)?.[1];
  assert.ok(labelName);assert.ok(iconName);
  assert.ok(existsSync(new URL('AppScope/resources/base/element/string.json',root)),'application label resource must exist in AppScope');
  const strings=JSON.parse(read('AppScope/resources/base/element/string.json')).string;
  assert.equal(strings.find(s=>s.name===labelName)?.value,'学知守护');
  assert.ok(['svg','png','jpg'].some(ext=>existsSync(new URL(`AppScope/resources/base/media/${iconName}.${ext}`,root))),`missing application icon ${iconName}`);
});
