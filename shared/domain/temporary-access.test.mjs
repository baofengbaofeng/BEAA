import test from 'node:test';
import assert from 'node:assert/strict';
import {createTemporaryAccess,validateTemporaryAccess,observeTemporaryAccess,getTemporaryAccessStatus,closeTemporaryAccess,TemporaryAccessError} from './temporary-access.mjs';
const context=(extra={})=>({nowMs:1000000,phase:'AVAILABLE',cycleRemainingSeconds:1800,dailyRemainingSeconds:7200,...extra});
const fresh=(minutes=5)=>createTemporaryAccess({permitId:'permit-1',minutes},context());
test('a bounded permit copies input and has explicit wall deadline and usage budget',()=>{
 const s=fresh();assert.equal(s.budgetSeconds,300);assert.equal(s.expiresAtMs,1300000);assert.equal(s.usedSeconds,0);assert.equal(getTemporaryAccessStatus(s,context()).remainingSeconds,300);assert.equal(getTemporaryAccessStatus(s,context()).advisoryOnly,true);
 const copy=validateTemporaryAccess(s);copy.usedSeconds=1;assert.equal(s.usedSeconds,0);
});
test('issuance rejects blocked phases and cannot enlarge cycle or daily quota',()=>{
 for(const phase of ['CHALLENGE_REQUIRED','CHALLENGE_ACTIVE','REST_REQUIRED','DAILY_LOCKED','SCHEDULE_LOCKED'])assert.throws(()=>createTemporaryAccess({permitId:'p',minutes:5},context({phase})),e=>e.code==='NOT_AVAILABLE');
 for(const extra of [{cycleRemainingSeconds:299},{dailyRemainingSeconds:299}])assert.throws(()=>createTemporaryAccess({permitId:'p',minutes:5},context(extra)),e=>e.code==='INSUFFICIENT_ALLOWANCE');
 assert.equal(createTemporaryAccess({permitId:'p',minutes:1},context({cycleRemainingSeconds:60,dailyRemainingSeconds:60})).budgetSeconds,60);
});
test('minute limits, IDs, context and snapshot fields are strictly validated',()=>{
 for(const minutes of [0,31,1.5,NaN,'5'])assert.throws(()=>fresh(minutes),e=>e instanceof TemporaryAccessError);
 for(const request of [{permitId:'',minutes:5},{permitId:'p',minutes:5,admin:true}])assert.throws(()=>createTemporaryAccess(request,context()));
 for(const value of [null,{}, {...fresh(),version:2},{...fresh(),usedSeconds:301},{...fresh(),closedReason:'unknown'},{...fresh(),expiresAtMs:1}])assert.throws(()=>validateTemporaryAccess(value));
 assert.throws(()=>getTemporaryAccessStatus(fresh(),context({phase:'fake'})));
});
test('remaining time is bounded by usage, wall expiry and current policy allowance',()=>{
 const next=observeTemporaryAccess(fresh(),{nowMs:1060000,usedSeconds:60});assert.equal(next.usedSeconds,60);assert.equal(getTemporaryAccessStatus(next,context({nowMs:1120000})).remainingSeconds,180);
 assert.equal(getTemporaryAccessStatus(next,context({nowMs:1120000,dailyRemainingSeconds:60})).remainingSeconds,60);
 assert.equal(getTemporaryAccessStatus(next,context({nowMs:1120000,cycleRemainingSeconds:30})).remainingSeconds,30);
 assert.equal(getTemporaryAccessStatus(next,context({nowMs:1120000,phase:'REST_REQUIRED'})).reason,'guardian_blocked');
});
test('exact expiry closes permanently and cannot become an ordinary available grant',()=>{
 const s=fresh();assert.equal(getTemporaryAccessStatus(s,context({nowMs:1299999})).active,true);assert.equal(getTemporaryAccessStatus(s,context({nowMs:1300000})).active,false);
 const next=observeTemporaryAccess(s,{nowMs:1300000,usedSeconds:0});assert.equal(next.closedReason,'expired');assert.equal(getTemporaryAccessStatus(next,context({nowMs:1000000})).active,false);
 assert.throws(()=>observeTemporaryAccess(next,{nowMs:1300000,usedSeconds:1}),e=>e.code==='ACCESS_INACTIVE');
});
test('consumption exhausts a grant without resetting its issued budget or input',()=>{
 const s=fresh(),next=observeTemporaryAccess(s,{nowMs:1000001,usedSeconds:300});assert.equal(next.closedReason,'budget_exhausted');assert.equal(next.usedSeconds,300);assert.equal(s.usedSeconds,0);assert.equal(getTemporaryAccessStatus(next,context()).active,false);
 assert.throws(()=>observeTemporaryAccess(s,{nowMs:1000001,usedSeconds:301}),e=>e.code==='BUDGET_EXCEEDED');
});
test('backward time permanently closes the permit and negative or unsafe samples fail',()=>{
 const next=observeTemporaryAccess(fresh(),{nowMs:999999,usedSeconds:0});assert.equal(next.closedReason,'clock_rollback');assert.equal(getTemporaryAccessStatus(next,context()).active,false);
 for(const usedSeconds of [-1,0.5,Infinity])assert.throws(()=>observeTemporaryAccess(fresh(),{nowMs:1000001,usedSeconds}));
 assert.throws(()=>createTemporaryAccess({permitId:'p',minutes:30},context({nowMs:Number.MAX_SAFE_INTEGER})));
});
test('parent cancellation is terminal and duplicate closing or zero samples do not add usage',()=>{
 const next=closeTemporaryAccess(fresh(),1000000);assert.equal(next.closedReason,'parent_closed');assert.deepEqual(closeTemporaryAccess(next,1000001),next);assert.equal(getTemporaryAccessStatus(next,context()).active,false);
 assert.equal(observeTemporaryAccess(fresh(),{nowMs:1000001,usedSeconds:0}).usedSeconds,0);
});

test('status never rounds a partial wall second up into usable full seconds',()=>{
 assert.equal(getTemporaryAccessStatus(fresh(1),context({nowMs:1001001})).remainingSeconds,58);
});
