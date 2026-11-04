import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Phase,createSession,recordUsage,startChallenge,submitAnswer,finishRest,rollDay } from './engine.mjs';
import { SnapshotError,validateSession,encodeSession,decodeSession } from './snapshot.mjs';

const policy={periodMinutes:30,dailyLimitMinutes:120,restMinutes:10,questionCount:5,requiredCorrect:5,grade:3,subjects:['chinese','math','english']};
const ids=['a','b','c','d','e'];
const initial=()=>createSession(policy,'2026-11-04');
const due=()=>recordUsage(initial(),1800);
const active=()=>startChallenge(due(),ids);
const complete=(failed=false)=>ids.reduce((s,id,i)=>submitAnswer(s,id,failed&&i===0?'B':'A','A'),active());
const envelope=session=>({schemaVersion:1,revision:3,session});
const rejected=operation=>assert.throws(operation,error=>error instanceof SnapshotError);

test('snapshots round-trip every reachable phase without changing counters or answers',()=>{
 const states=[initial(),recordUsage(initial(),600),due(),active(),submitAnswer(active(),'a','A','A'),complete(true),complete(),recordUsage(initial(),7200),finishRest(complete(),600)];
 for(const state of states){
  const decoded=decodeSession(encodeSession(state,7));
  assert.equal(decoded.schemaVersion,1);assert.equal(decoded.revision,7);assert.deepEqual(decoded.session,state);
 }
});

test('disk recovery preserves pending rest and daily usage before the next cycle',t=>{
 const directory=mkdtempSync(join(tmpdir(),'beaa-snapshot-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const path=join(directory,'session.json');writeFileSync(path,encodeSession(complete(),4),{mode:0o600});
 const {session,revision}=decodeSession(readFileSync(path,'utf8'));assert.equal(revision,4);
 assert.throws(()=>finishRest(session,599));const next=finishRest(session,600);
 assert.equal(next.phase,Phase.AVAILABLE);assert.equal(next.dailySeconds,1800);
 assert.throws(()=>finishRest(next,600));
 assert.equal(recordUsage(next,7200).phase,Phase.DAILY_LOCKED);
 writeFileSync(path,'{truncated');rejected(()=>decodeSession(readFileSync(path,'utf8')));
});

test('resumed answers remain ordered and rejected answers do not mutate the snapshot',()=>{
 const partial=submitAnswer(active(),'a','A','A');const recovered=decodeSession(encodeSession(partial)).session;
 assert.throws(()=>submitAnswer(recovered,'a','A','A'));assert.deepEqual(recovered,partial);
 assert.equal(submitAnswer(recovered,'b','A','A').challenge.answers.length,2);
});

test('cross-day recovery keeps restrictions even when cycle usage exceeds new daily usage',()=>{
 for(const state of [recordUsage(initial(),1200),active(),complete(),complete(true),recordUsage(initial(),7200)]){
  const next=rollDay(state,'2026-11-05');const recovered=decodeSession(encodeSession(next)).session;
  assert.deepEqual(recovered,next);assert.equal(recovered.dailySeconds,0);
 }
});

test('malformed, non-string and oversized input fail without creating a new session',()=>{
 for(const value of ['{broken','null','[]','42','{}','',null,undefined,{}])rejected(()=>decodeSession(value));
 assert.throws(()=>decodeSession(' '.repeat(1000001)),e=>e.code==='SNAPSHOT_TOO_LARGE');
});

test('unsupported versions, invalid revisions and extra envelope fields are rejected',()=>{
 const s=initial();
 assert.throws(()=>decodeSession(JSON.stringify({...envelope(s),schemaVersion:2})),e=>e.code==='UNSUPPORTED_VERSION');
 for(const revision of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'1',null]){
  rejected(()=>encodeSession(s,revision));rejected(()=>decodeSession(JSON.stringify({...envelope(s),revision})));
 }
 rejected(()=>decodeSession(JSON.stringify({...envelope(s),extra:'unexpected'})));
 assert.equal(decodeSession(encodeSession(s,Number.MAX_SAFE_INTEGER)).revision,Number.MAX_SAFE_INTEGER);
});

test('restored grants require a complete passing challenge and the rest phase',()=>{
 const rest=complete();
 const invalid=[
  {...rest,challenge:null}, {...rest,pendingGrant:false},
  {...rest,challenge:{...rest.challenge,answers:rest.challenge.answers.slice(0,4)}},
  {...complete(true),phase:Phase.REST_REQUIRED,pendingGrant:true},
  {...initial(),pendingGrant:true}, {...rest,phase:Phase.AVAILABLE},
  {...rest,phase:Phase.CHALLENGE_ACTIVE}, {...rest,phase:Phase.CHALLENGE_REQUIRED,pendingGrant:false}
 ];
 for(const s of invalid)rejected(()=>decodeSession(JSON.stringify(envelope(s))));
});

test('daily cap, counters and phase contradictions are not silently clamped',()=>{
 const invalid=[
  {...initial(),dailySeconds:-1}, {...initial(),dailySeconds:0.5}, {...initial(),cycleSeconds:NaN},
  {...initial(),cycleSeconds:86401}, {...initial(),dailySeconds:7201},
  {...initial(),dailySeconds:7200}, {...initial(),phase:Phase.DAILY_LOCKED},
  {...initial(),cycleSeconds:1800}, {...initial(),phase:Phase.CHALLENGE_REQUIRED},
  {...initial(),phase:'UNKNOWN'}, {...initial(),pendingGrant:1}, {...initial(),dayKey:'2026-11-31'}
 ];
 for(const s of invalid)rejected(()=>validateSession(s));
});

test('invalid question identifiers, duplicate/out-of-order answers and unknown fields fail',()=>{
 const s=active();
 const invalid=[
  {...s,challenge:{questionIds:new Array(5),answers:[]}},
  {...s,challenge:{questionIds:['a','a','c','d','e'],answers:[]}},
  {...s,challenge:{questionIds:ids,answers:[{questionId:'b',chosen:'A',correct:true}]}},
  {...s,challenge:{questionIds:ids,answers:[{questionId:'a',chosen:'',correct:true}]}},
  {...s,challenge:{questionIds:ids,answers:[{questionId:'a',chosen:'A',correct:'true'}]}},
  {...s,challenge:{questionIds:ids,answers:[{questionId:'a',chosen:'A',correct:true,expected:'A'}]}},
  {...s,challenge:{questionIds:ids,answers:new Array(1)}},
  {...initial(),extra:'unexpected'},
  {...initial(),policy:{...policy,version:2}},
  {...initial(),policy:{...policy,secret:'not-a-policy-field'}},
  {...initial(),policy:{...policy,subjects:new Array(1)}},
  {...initial(),policy:{...policy,subjects:Object.assign([...policy.subjects],{extra:'unsupported'})}}
 ];
 for(const state of invalid)rejected(()=>validateSession(state));
 assert.equal(validateSession({...initial(),policy:{...policy,version:1}}).policy.version,1);
});

test('validation returns an independent copy without mutating the live engine',()=>{
 const s=submitAnswer(active(),'a','A','A');const before=structuredClone(s);const copy=validateSession(s);
 copy.policy.subjects[0]='english';copy.challenge.answers[0].correct=false;assert.deepEqual(s,before);
 rejected(()=>validateSession({...s,cycleSeconds:-1}));assert.deepEqual(s,before);
});

test('daily-cap defensive output retains a completed quiz for next-day rest reconciliation',()=>{
 const locked=finishRest({...complete(),dailySeconds:7200},600);
 const recovered=decodeSession(encodeSession(locked)).session;
 assert.equal(recovered.phase,Phase.DAILY_LOCKED);assert.equal(recovered.pendingGrant,false);
 const next=rollDay(recovered,'2026-11-05');
 assert.equal(next.phase,Phase.REST_REQUIRED);assert.equal(next.pendingGrant,true);
 assert.deepEqual(decodeSession(encodeSession(next)).session,next);
 assert.throws(()=>finishRest(next,599));assert.equal(finishRest(next,600).phase,Phase.AVAILABLE);
});


test('snapshot grants follow the configured correct-answer threshold',()=>{
 const custom={...policy,requiredCorrect:3};let state=startChallenge(recordUsage(createSession(custom,'2026-11-04'),1800),ids);
 state=ids.reduce((s,id,i)=>submitAnswer(s,id,i<3?'A':'B','A'),state);
 assert.equal(state.phase,Phase.REST_REQUIRED);assert.deepEqual(decodeSession(encodeSession(state)).session,state);
 rejected(()=>validateSession({...state,policy:{...custom,requiredCorrect:4}}));
});
