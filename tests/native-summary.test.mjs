import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadNativeCore} from './helpers/native-core.mjs';
const {NativeSummaryService,validateSummary,writeAllUtf8}=loadNativeCore(['NativeSummary']);
const summary=()=>({schemaVersion:1,generatedAt:1793966400000,simulated:true,deviceControlValidated:false,day:'2026-11-06',dailyUsedMinutes:0.5,dailyUsedSeconds:30,recordWindow:200,records:[{at:1793966400000,correct:4,total:5,passed:false}],wrongAnswerCount:1});
const text=()=>JSON.stringify(summary());
function port(overrides={}){return {choose:async()=>['chosen://summary.json'],open:async()=>7,encode:s=>new TextEncoder().encode(s),write:async(fd,b)=>b.byteLength,sync:async()=>{},close:async()=>{},...overrides};}
test('summary validation preserves only the exact public simulated contract',()=>{assert.deepEqual(JSON.parse(validateSummary(text())),summary());});
test('private fields, real-device claims, malformed dates and inconsistent counters are rejected',()=>{
 for(const extra of [{pinHash:'private'},{simulated:false},{deviceControlValidated:true},{dailyUsedSeconds:31},{day:'2026-02-30'},{recordWindow:201},{generatedAt:-1},{wrongAnswerCount:201},{records:[{...summary().records[0],pin:'secret'}]}])assert.throws(()=>validateSummary(JSON.stringify({...summary(),...extra})));
 for(const s of ['null','{bad',' '.repeat(64001)])assert.throws(()=>validateSummary(s));
});
test('saving writes a real UTF8 file across short writes then syncs and closes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'beaa-summary-'));let handle,synced=false,closed=false,writes=0;
 try{const service=new NativeSummaryService(port({choose:async()=>[join(dir,'学习摘要.json')],open:async path=>{handle=await open(path,'w');return handle.fd;},write:async(fd,buffer,offset)=>{writes++;const bytes=new Uint8Array(buffer),length=Math.min(7,bytes.length);return (await handle.write(bytes,0,length,offset)).bytesWritten;},sync:async()=>{await handle.sync();synced=true;},close:async()=>{await handle.close();closed=true;}}));assert.equal(await service.exportSummary(text()),'saved');assert(writes>1&&synced&&closed);assert.equal(readFileSync(join(dir,'学习摘要.json'),'utf8'),validateSummary(text()));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('cancel and invalid input never open a path and busy export cannot show a second picker',async()=>{
 let opens=0,release;const service=new NativeSummaryService(port({choose:()=>new Promise(resolve=>release=resolve),open:async()=>{opens++;return 7;}}));const first=service.exportSummary(text());assert.equal(await service.exportSummary(text()),'busy');release([]);assert.equal(await first,'cancelled');assert.equal(opens,0);assert.equal(await service.exportSummary('{bad'),'invalid_summary');
});
test('short write stalls, sync and close failures never report saved or expose paths',async()=>{
 for(const extra of [{write:async()=>0},{write:async()=>{throw Error('private-path');}},{sync:async()=>{throw Error('secret');}},{close:async()=>{throw Error('private');}}]){let closed=0;const p=port({close:async()=>{closed++;},...extra});assert.equal(await new NativeSummaryService(p).exportSummary(text()),'failed');if(!extra.close)assert.equal(closed,1);}
});

test('multibyte UTF8 remains intact when a write ends inside a character',async()=>{
 const chunks=[];const p=port({write:async(fd,buffer)=>{const bytes=new Uint8Array(buffer),count=Math.min(3,bytes.length);chunks.push(Buffer.from(bytes.slice(0,count)));return count;}});await writeAllUtf8(p,7,'学知守护 🌱');assert.equal(Buffer.concat(chunks).toString('utf8'),'学知守护 🌱');
});
