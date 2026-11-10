import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {loadNativeCore} from './helpers/native-core.mjs';
const {nativeReading}=loadNativeCore(['NativeChineseReading']);
const root=new URL('../apps/harmony/entry/src/main/ets/',import.meta.url);
function sources(path){return readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?sources(join(path,e.name)):/\.(ets|ts)$/.test(e.name)&&e.name!=='NativeChineseReading.ts'?[join(path,e.name)]:[]);}
import {fileURLToPath} from 'node:url';
test('all native source Chinese phrases have offline reading above original characters',()=>{for(const path of sources(fileURLToPath(root)))for(const phrase of readFileSync(path,'utf8').match(/[\u3400-\u9fff]+/g)||[]){const [reading,original]=nativeReading(phrase).split('\n');assert.equal(original,phrase);assert.doesNotMatch(reading,/[\u3400-\u9fff□]/);assert.match(reading,/[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i);}});
test('native dynamic statuses preserve counters and mixed Latin while adding contextual reading',()=>{const original='练习日 2 · 已练习 99秒 / 7200秒 · 资格 1701秒 · 待休息 0秒';const text=nativeReading(original);assert.ok(text.endsWith('\n'+original));assert.match(text,/99/);assert.equal(nativeReading('123456'),'123456');assert.match(nativeReading('可重新开始'),/chóng xīn/);});
test('native labels and placeholders all use reading wrapper; practice defaults collapsed with scroll controls and bounded preview',()=>{const index=readFileSync(new URL('pages/Index.ets',root),'utf8');assert.doesNotMatch(index, /(?:Text|Button)\((?!nativeReading\()/);assert.doesNotMatch(index,/placeholder:\s*['"][^'"]*[\u3400-\u9fff]/);assert.match(index,/practiceOpen: boolean = false/);assert.match(index,/if \(this.practiceOpen\)/);assert.match(index,/Scroll\(\)/);assert.match(index,/constraintSize\(\{ minHeight: 160, maxHeight: 480 \}\)/);assert.doesNotMatch(index,/methodList:[^\n]*nativeReading/);});
test('native notifications annotate display text while preserving publish and cancel routing',()=>{const port=readFileSync(new URL('services/NativeNotificationPort.ets',root),'utf8');assert.match(port,/normal: \{ title: nativeReading\(title\), text: nativeReading\(text\) \}/);assert.match(port,/publish\(\{ id: id, label: 'beaa-preview-reminder'/);assert.match(port,/cancel\(id, 'beaa-preview-reminder'\)/);});
