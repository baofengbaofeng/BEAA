import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Phase } from './engine.mjs';
import { fresh,advance } from '../../tests/helpers/quiz-progress-fixture.mjs';
import { RestProgressError,createRestProgress,validateRestProgress,observeRestInterval,getRestStatus,getRestSession,completeVerifiedRest,encodeRestProgress,decodeRestProgress } from './rest-progress.mjs';
const source=()=>advance(fresh(),5).attempt.session;
const begin=(session=source())=>createRestProgress('rest-round-1',session,{bootId:'boot-1',monotonicMs:1000});
const interval=(p,toMs,condition='resting',overrides={})=>({restId:p.restId,expectedRevision:p.revision,bootId:p.bootId,fromMs:p.cursorMs,toMs,condition,...overrides});
const observe=(p,toMs,condition='resting',overrides={})=>observeRestInterval(p,interval(p,toMs,condition,overrides)).progress;
const checkpoint=p=>({bootId:p.bootId,monotonicMs:p.cursorMs});
const rejects=(operation,code)=>assert.throws(operation,e=>e instanceof RestProgressError && (!code || e.code===code));

test('rest evidence starts empty and accepts only a pending passing session',()=>{
 const s=source(),p=begin(s);assert.equal(getRestStatus(p).verifiedSeconds,0);assert.equal(getRestStatus(p).remainingSeconds,600);
 assert.equal(getRestStatus(p).ready,false);assert.equal(getRestStatus(p).completed,false);assert.equal(getRestSession(p).phase,Phase.REST_REQUIRED);
 s.policy.restMinutes=0;assert.equal(p.sourceSession.policy.restMinutes,10);
 const clone=validateRestProgress(p);clone.sourceSession.dailySeconds=0;assert.equal(p.sourceSession.dailySeconds,1800);
 rejects(()=>createRestProgress('x',fresh().attempt.session,{bootId:'b',monotonicMs:0}));
 rejects(()=>createRestProgress('x',advance(fresh(),5,{wrong:true}).attempt.session,{bootId:'b',monotonicMs:0}));
 for(const id of ['', ' padded ', 'x'.repeat(129)])rejects(()=>createRestProgress(id,source(),{bootId:'b',monotonicMs:0}));
});

test('ten minutes requires the full verified interval with conservative millisecond rounding',()=>{
 const before=begin(),p=observe(before,600999);assert.equal(getRestStatus(p).verifiedSeconds,599);assert.equal(getRestStatus(p).remainingSeconds,1);
 rejects(()=>completeVerifiedRest(p,checkpoint(p)),'REST_NOT_COMPLETE');
 const ready=observe(p,601000);assert.equal(getRestStatus(ready).verifiedSeconds,600);assert.equal(getRestStatus(ready).ready,true);
 const completed=completeVerifiedRest(ready,checkpoint(ready));assert.equal(completed.session.phase,Phase.AVAILABLE);
 assert.equal(completed.session.dailySeconds,1800);assert.equal(completed.session.cycleSeconds,0);assert.equal(completed.session.pendingGrant,false);
 assert.equal(getRestSession(ready).phase,Phase.REST_REQUIRED);assert.equal(before.revision,0);
});

test('a current clock checkpoint cannot fill unobserved rest time or use an old boot',()=>{
 const p=observe(begin(),301000);
 rejects(()=>completeVerifiedRest(p,{bootId:p.bootId,monotonicMs:99999999}),'REST_NOT_COMPLETE');
 const ready=observe(p,601000);
 rejects(()=>completeVerifiedRest(ready,{bootId:'new-boot',monotonicMs:100}),'STALE_EVIDENCE');
 rejects(()=>completeVerifiedRest(ready,{bootId:ready.bootId,monotonicMs:600999}),'STALE_EVIDENCE');
 rejects(()=>completeVerifiedRest(ready));
 assert.equal(completeVerifiedRest(ready,{bootId:ready.bootId,monotonicMs:601100}).session.phase,Phase.AVAILABLE);
});

test('split contiguous resting intervals accumulate without duplicate credit',()=>{
 let p=begin();const first=interval(p,301000),result=observeRestInterval(p,first);p=result.progress;
 assert.equal(result.duplicate,false);assert.equal(getRestStatus(p).verifiedSeconds,300);
 const duplicate=observeRestInterval(p,{...first});assert.equal(duplicate.duplicate,true);assert.deepEqual(duplicate.progress,p);
 p=observe(duplicate.progress,601000);assert.equal(getRestStatus(p).verifiedSeconds,600);
 const altered={...first,toMs:first.toMs+1};
 rejects(()=>observeRestInterval(p,altered),'CONFLICT');
 rejects(()=>observeRestInterval(p,first),'CONFLICT');
});

test('active and unknown intervals reset a formerly ready continuous rest',()=>{
 for(const condition of ['active','unknown']){
  const ready=observe(begin(),601000),p=observe(ready,602000,condition);
  assert.equal(getRestStatus(p).ready,false);assert.equal(getRestStatus(p).verifiedSeconds,0);
  rejects(()=>completeVerifiedRest(p,checkpoint(p)),'REST_NOT_COMPLETE');
  const next=observe(p,902000);assert.equal(getRestStatus(next).verifiedSeconds,300);
 }
});

test('a gap discards the old run and counts only the new verified interval',()=>{
 const p=observe(begin(),301000),event=interval(p,1201000,'resting',{fromMs:901000});
 const result=observeRestInterval(p,event);
 assert.equal(result.reason,'gap');assert.equal(getRestStatus(result.progress).verifiedSeconds,300);
 assert.equal(getRestStatus(result.progress).ready,false);assert.equal(result.progress.restStartedMs,901000);
});

test('a new boot establishes a fresh boundary without crediting its first interval',()=>{
 const ready=observe(begin(),601000),event=interval(ready,700000,'resting',{bootId:'boot-2',fromMs:0});
 const result=observeRestInterval(ready,event);assert.equal(result.reason,'boot_changed');
 assert.equal(result.progress.bootId,'boot-2');assert.equal(getRestStatus(result.progress).verifiedSeconds,0);
 rejects(()=>completeVerifiedRest(result.progress,checkpoint(result.progress)),'REST_NOT_COMPLETE');
 assert.equal(getRestStatus(observe(result.progress,1300000)).ready,true);
});

test('backwards and overlapping monotonic ranges discard prior credit rather than extend it',()=>{
 for(const range of [{fromMs:0,toMs:100},{fromMs:600000,toMs:602000}]){
  const ready=observe(begin(),601000),result=observeRestInterval(ready,interval(ready,range.toMs,'resting',{fromMs:range.fromMs}));
  assert.equal(result.reason,'clock_discontinuity');assert.equal(result.progress.cursorMs,range.toMs);
  assert.equal(getRestStatus(result.progress).verifiedSeconds,0);assert.equal(getRestStatus(result.progress).ready,false);
 }
});

test('round IDs, revision expectations and interval bounds reject malformed events',()=>{
 const p=begin(),good=interval(p,301000);
 for(const mutate of [e=>e.fromMs=-1,e=>e.toMs=e.fromMs-1,e=>e.toMs=NaN,e=>e.toMs=Number.MAX_SAFE_INTEGER+1,e=>e.toMs=e.fromMs+86400001,e=>e.condition='idle',e=>e.expectedRevision=0.5,e=>e.bootId=' ',e=>e.wallClock=Date.now(),e=>delete e.condition]){
  const e={...good};mutate(e);rejects(()=>observeRestInterval(p,e));
 }
 rejects(()=>observeRestInterval(p,{...good,restId:'another-round'}),'CONFLICT');
 rejects(()=>observeRestInterval(p,{...good,expectedRevision:1}),'CONFLICT');
 assert.equal(getRestStatus(p).verifiedSeconds,0);assert.equal(p.revision,0);
 for(const anchor of [{bootId:'b',monotonicMs:-1},{bootId:'b',monotonicMs:NaN},{bootId:'b',monotonicMs:0,wallClock:1},null])rejects(()=>createRestProgress('x',source(),anchor));
});

test('completion and retry retain a single receipt and an unchanged usage ledger',()=>{
 const ready=observe(begin(),601000),result=completeVerifiedRest(ready,checkpoint(ready));
 assert.equal(result.duplicate,false);assert.equal(getRestStatus(result.progress).completed,true);assert.equal(getRestStatus(result.progress).phase,Phase.AVAILABLE);
 const again=completeVerifiedRest(result.progress,{bootId:'new-boot',monotonicMs:0});
 assert.equal(again.duplicate,true);assert.equal(again.progress.revision,result.progress.revision);assert.deepEqual(again.session,result.session);
 const decoded=decodeRestProgress(encodeRestProgress(result.progress));assert.deepEqual(getRestSession(decoded),result.session);
 rejects(()=>observeRestInterval(decoded,interval(decoded,602000)),'ALREADY_COMPLETED');
 const last=ready.lastInterval.command;assert.equal(observeRestInterval(decoded,last).duplicate,true);
 result.session.policy.dailyLimitMinutes=1;assert.equal(getRestSession(decoded).policy.dailyLimitMinutes,120);
});

test('zero-rest policies finish without invented elapsed time',()=>{
 const s=source();s.policy.restMinutes=0;const p=begin(s);
 assert.equal(getRestStatus(p).ready,true);assert.equal(getRestStatus(p).verifiedSeconds,0);
 const done=completeVerifiedRest(p,checkpoint(p));assert.equal(done.session.phase,Phase.AVAILABLE);
 assert.deepEqual(getRestSession(decodeRestProgress(encodeRestProgress(done.progress))),done.session);
});

test('long verified runs finish without overflowing the legacy seconds input range',()=>{
 let p=begin();p=observe(p,86401000);p=observe(p,172801000);
 assert.equal(getRestStatus(p).verifiedSeconds,172800);assert.equal(completeVerifiedRest(p,checkpoint(p)).session.phase,Phase.AVAILABLE);
});

test('mid-rest file restoration resumes a verified run with no wall-clock input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'beaa-rest-'));
 try{const file=join(dir,'rest.json'),p=observe(begin(),301000);writeFileSync(file,encodeRestProgress(p),{mode:0o600});
 const restored=decodeRestProgress(readFileSync(file,'utf8'));assert.deepEqual(restored,p);assert.equal(getRestStatus(restored).remainingSeconds,300);
 const ready=observe(restored,601000);assert.equal(completeVerifiedRest(ready,checkpoint(ready)).session.dailySeconds,1800);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('corrupt snapshots are rejected without clearing evidence or usage',()=>{
 const p=observe(begin(),301000);
 for(const mutate of [v=>v.restStartedMs=v.cursorMs+1,v=>v.restStartedMs=null,v=>v.cursorMs++,v=>v.bootId='other',v=>v.lastInterval.command.expectedRevision++,v=>v.lastInterval.resetReason='unknown',v=>v.revision=-1,v=>v.sourceSession.pendingGrant=false,v=>v.sourceSession.dailySeconds=7200,v=>v.extra=true,v=>delete v.lastInterval.command.condition,v=>v.completion={bootId:v.bootId,monotonicMs:v.cursorMs}]){
  const bad=structuredClone(p);mutate(bad);rejects(()=>decodeRestProgress(JSON.stringify(bad)));
 }
 const first=begin();first.restStartedMs=first.cursorMs;rejects(()=>validateRestProgress(first));
 const finished=completeVerifiedRest(observe(begin(),601000),{bootId:'boot-1',monotonicMs:601000}).progress;
 finished.completion.bootId='wrong';rejects(()=>validateRestProgress(finished));
 for(const text of ['{','null','[]','{}'])rejects(()=>decodeRestProgress(text));
 const version=structuredClone(p);version.schemaVersion=2;rejects(()=>decodeRestProgress(JSON.stringify(version)),'UNSUPPORTED_VERSION');
 rejects(()=>decodeRestProgress(' '.repeat(1000001)),'SNAPSHOT_TOO_LARGE');
 assert.equal(getRestStatus(p).verifiedSeconds,300);assert.equal(p.sourceSession.dailySeconds,1800);
});

test('revision exhaustion fails explicitly instead of rounding into duplicate revisions',()=>{
 const p=observe(begin(),601000);p.revision=Number.MAX_SAFE_INTEGER;p.lastInterval.command.expectedRevision=Number.MAX_SAFE_INTEGER-1;
 validateRestProgress(p);
 rejects(()=>observeRestInterval(p,interval(p,602000)),'REVISION_EXHAUSTED');
 rejects(()=>completeVerifiedRest(p,checkpoint(p)),'REVISION_EXHAUSTED');
});

test('first interval snapshots cannot invent rest credit before their only verified interval',()=>{
 const half=observe(createRestProgress('rest-round-1',source(),{bootId:'boot-1',monotonicMs:301000}),601000);
 assert.equal(getRestStatus(half).verifiedSeconds,300);
 for(const completed of [false,true]){
  const corrupt=structuredClone(half);corrupt.restStartedMs=1000;
  if(completed){corrupt.completion={bootId:'boot-1',monotonicMs:601000};corrupt.revision++;}
  rejects(()=>decodeRestProgress(JSON.stringify(corrupt)));
 }
 assert.equal(getRestStatus(half).ready,false);
});
