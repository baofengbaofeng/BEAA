import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('./quiet-hours.mjs').catch(()=>null);
function api(){assert.ok(module,'quiet hours rules must exist');return module;}
const night=[{days:[7],startMinute:21*60,endMinute:7*60}];
test('quiet hours include start and exclude end, retaining start weekday overnight',()=>{
 const {evaluateQuietHours:e}=api();
 assert.equal(e(night,{weekday:7,minute:1259}).blocked,false);
 assert.equal(e(night,{weekday:7,minute:1260}).blocked,true);
 assert.equal(e(night,{weekday:1,minute:0}).blocked,true);
 assert.equal(e(night,{weekday:1,minute:419}).blocked,true);
 assert.equal(e(night,{weekday:1,minute:420}).blocked,false);
 assert.equal(e(night,{weekday:2,minute:60}).blocked,false);
});
test('overlapping daytime windows form a union and gaps stay usable',()=>{
 const {evaluateQuietHours:e}=api();const windows=[{days:[1,3],startMinute:600,endMinute:660},{days:[1],startMinute:630,endMinute:720}];
 assert.deepEqual(e(windows,{weekday:1,minute:645}).matchingIndexes,[0,1]);
 assert.equal(e(windows,{weekday:1,minute:719}).blocked,true);
 assert.equal(e(windows,{weekday:1,minute:720}).blocked,false);
 assert.equal(e(windows,{weekday:3,minute:700}).blocked,false);
});
test('invalid local samples pause configured schedules, while empty schedules remain disabled',()=>{
 const {evaluateQuietHours:e}=api();
 for(const sample of [null,{}, {weekday:0,minute:5},{weekday:1,minute:1440},{weekday:1,minute:1.5}]){
  assert.equal(e(night,sample).blocked,true);assert.equal(e(night,sample).invalidTime,true);assert.equal(e([],sample).blocked,false);
 }
});
test('strict validation rejects ambiguous or damaged configuration and never mutates inputs',()=>{
 const {validateQuietWindows:v}=api();
 const input=[{days:[2,5],startMinute:0,endMinute:1}];const copy=v(input);copy[0].days.push(1);assert.deepEqual(input[0].days,[2,5]);
 for(const windows of [null,{},[null],[{days:[],startMinute:0,endMinute:1}],[{days:[1,1],startMinute:0,endMinute:1}],[{days:[8],startMinute:0,endMinute:1}],[{days:[1],startMinute:2,endMinute:2}],[{days:[1],startMinute:0,endMinute:1440}],[{days:[1],startMinute:0,endMinute:1,enabled:false}],Array(15).fill(input[0]),Array(1)])assert.throws(()=>v(windows));
 assert.equal(v(Array(14).fill(input[0])).length,14);
});
test('rest credit excludes quiet minutes, handles a long fully-blocked interval and caps earned credit',()=>{
 const {allowedQuietHoursElapsed:elapsed}=api();assert.equal(typeof elapsed,'function');
 const from=new Date(2026,10,9,20,59,30).getTime(),to=new Date(2026,10,9,21,2,30).getTime();
 const windows=[{days:[1],startMinute:21*60,endMinute:21*60+2}];
 assert.equal(elapsed(windows,from,to,600000),60000);
 assert.equal(elapsed([],from,to,30000),30000);
 const always=[{days:[1,2,3,4,5,6,7],startMinute:0,endMinute:720},{days:[1,2,3,4,5,6,7],startMinute:720,endMinute:0}];
 assert.equal(elapsed(always,from,from+10*365*86400000,600000),0);
 assert.equal(elapsed(windows,to,from,600000),0);
});
