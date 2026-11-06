import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {probeDeviceControl,createUnsupportedDeviceControlAdapter,readGuardedUsageView,DeviceControlError} from './device-control.mjs';
import {encodeGuardianLifecycle} from './guardian-lifecycle.mjs';
import {freshGuardian,step,beginGuardian,answerGuardian,observeGuardian} from '../../tests/helpers/guardian-fixture.mjs';

const scopeId='family-app-set';
const options={scopeId,timeoutMs:1000};
const capabilities=(changes={})=>({schemaVersion:1,scopeId,revision:7,usage:'supported',restriction:'supported',authorization:'authorized',...changes});
const observation=(changes={})=>({schemaVersion:1,scopeId,revision:7,status:'ok',state:'released',...changes});
function fixture(caps=capabilities(),observed=observation()){
 const calls=[];
 const adapter={getCapabilities(){calls.push('capabilities');return caps;},getRestrictionStatus(){calls.push('restriction');return observed;}};
 for(const action of ['requestAuthorization','restrictApps','releaseApps'])adapter[action]=()=>{throw Error('Must not perform device actions');};
 return {adapter,calls,caps,observed};
}
const storeFor=state=>({read:async()=>encodeGuardianLifecycle(state)});

test('unsupported default adapter never pretends to monitor, restrict or release',async()=>{
 const adapter=createUnsupportedDeviceControlAdapter(scopeId);
 for(const action of ['getCapabilities','getRestrictionStatus','requestAuthorization','restrictApps','releaseApps'])assert.equal(typeof adapter[action]().then,'function');
 const result=await probeDeviceControl(adapter,options);
 assert.equal(result.status,'unsupported');assert.equal(result.restriction,'unknown');assert.equal(result.deviceControlValidated,false);assert.equal(result.evidence,'adapter_report');
 for(const action of ['requestAuthorization','restrictApps','releaseApps'])assert.equal((await adapter[action]()).status,'unsupported');
 await assert.rejects(adapter.observeUsage().next(),error=>error instanceof DeviceControlError&&error.code==='UNSUPPORTED');
});
test('consistent authorized observations are reported with explicit evidence limits',async()=>{
 const {adapter,calls,caps}=fixture();const result=await probeDeviceControl(adapter,options);
 assert.equal(result.status,'reported_ready');assert.equal(result.restriction,'released');assert.equal(result.deviceControlValidated,false);
 assert.deepEqual(calls,['capabilities','restriction','capabilities']);caps.authorization='revoked';assert.equal(result.capabilities.authorization,'authorized');
});
for(const [changes,status] of [[{usage:'unsupported'},'unsupported'],[{restriction:'unknown'},'unverified'],[{authorization:'unauthorized'},'unauthorized'],[{authorization:'revoked'},'revoked'],[{authorization:'unknown'},'unverified'],[{usage:'unsupported',authorization:'revoked'},'revoked']]){
 test(`capability gate distinguishes ${JSON.stringify(changes)}`,async()=>{const {adapter,calls}=fixture(capabilities(changes));const result=await probeDeviceControl(adapter,options);assert.equal(result.status,status);assert.equal(result.restriction,'unknown');assert.deepEqual(calls,['capabilities']);});
}
for(const state of ['restricted','released','unknown'])test(`restriction state ${state} remains separate from capability support`,async()=>{
 const {adapter}=fixture(capabilities(),observation({state}));const result=await probeDeviceControl(adapter,options);assert.equal(result.status,state==='unknown'?'unverified':'reported_ready');assert.equal(result.restriction,state);
});
for(const status of ['unsupported','unauthorized','revoked','failed'])test(`runtime restriction query reports ${status}`,async()=>{
 const {adapter}=fixture(capabilities(),{schemaVersion:1,scopeId,revision:7,status});const result=await probeDeviceControl(adapter,options);assert.equal(result.status,status);assert.equal(result.restriction,'unknown');
});
test('invalid capability responses fail closed without querying restriction',async()=>{
 const samples=[null,[],{},capabilities({schemaVersion:2}),capabilities({usage:true}),capabilities({authorization:'granted'}),capabilities({revision:-1}),capabilities({revision:1.5}),capabilities({extra:true}),Object.fromEntries(Object.entries(capabilities()).filter(([k])=>k!=='usage'))];
 for(const value of samples){const {adapter,calls}=fixture(value);const result=await probeDeviceControl(adapter,options);assert.equal(result.status,'failed');assert.equal(result.reason,'INVALID_RESPONSE');assert.deepEqual(calls,['capabilities']);}
});
test('invalid status responses never imply a released device',async()=>{
 for(const value of [null,{},observation({schemaVersion:2}),observation({state:'unlocked'}),observation({extra:true}),observation({status:'revoked'}),{schemaVersion:1,scopeId,revision:7,status:'ok'}]){
  const {adapter}=fixture(capabilities(),value);const result=await probeDeviceControl(adapter,options);assert.equal(result.status,'failed');assert.equal(result.reason,'INVALID_RESPONSE');assert.equal(result.restriction,'unknown');
 }
});
test('scope and revision mismatches fail closed',async()=>{
 for(const [caps,observed,reason] of [[capabilities({scopeId:'other'}),observation(),'SCOPE_MISMATCH'],[capabilities(),observation({scopeId:'other'}),'SCOPE_MISMATCH'],[capabilities(),observation({revision:6}),'CAPABILITIES_CHANGED']]){
  const {adapter}=fixture(caps,observed);const result=await probeDeviceControl(adapter,options);assert.notEqual(result.status,'reported_ready');assert.equal(result.reason,reason);assert.equal(result.restriction,'unknown');
 }
});
test('permission revoked during the query cannot return a ready result',async()=>{
 const f=fixture();f.adapter.getRestrictionStatus=()=>{f.caps.authorization='revoked';f.caps.revision++;return observation();};
 const result=await probeDeviceControl(f.adapter,options);assert.equal(result.status,'revoked');assert.equal(result.restriction,'unknown');
});
test('a configuration revision change discards otherwise valid observations',async()=>{
 const f=fixture();f.adapter.getRestrictionStatus=()=>{f.caps.revision++;return observation();};const result=await probeDeviceControl(f.adapter,options);assert.equal(result.status,'unverified');assert.equal(result.reason,'CAPABILITIES_CHANGED');assert.equal(result.restriction,'unknown');
});
test('mutation of the earlier capability object cannot rewrite its captured revision',async()=>{
 const f=fixture();f.adapter.getRestrictionStatus=()=>{f.caps.revision=8;return observation({revision:8});};const result=await probeDeviceControl(f.adapter,options);assert.notEqual(result.status,'reported_ready');assert.equal(result.reason,'CAPABILITIES_CHANGED');
});
test('adapter exceptions and rejection messages are not exported',async()=>{
 for(const name of ['getCapabilities','getRestrictionStatus'])for(const asyncFailure of [false,true]){
  const f=fixture();f.adapter[name]=()=>{if(asyncFailure)return Promise.reject(Error('private-device-detail'));throw Error('private-device-detail');};const result=await probeDeviceControl(f.adapter,options);assert.equal(result.status,'failed');assert.equal(result.reason,'ADAPTER_FAILURE');assert(!JSON.stringify(result).includes('private-device-detail'));
 }
});
test('timeout is bounded and a late response does not resume further queries',async()=>{
 const f=fixture();let release;f.adapter.getCapabilities=()=>{f.calls.push('pending');return new Promise(resolve=>{release=resolve;});};
 const result=await probeDeviceControl(f.adapter,{scopeId,timeoutMs:20});assert.equal(result.status,'failed');assert.equal(result.reason,'TIMEOUT');const saved=JSON.stringify(result);release(capabilities());await delay(0);assert.equal(JSON.stringify(result),saved);assert.deepEqual(f.calls,['pending']);
});
test('timeout covers all probes together rather than resetting for each step',async()=>{
 const f=fixture();f.adapter.getCapabilities=async()=>{await delay(20);return capabilities();};f.adapter.getRestrictionStatus=()=>new Promise(()=>{});
 const result=await probeDeviceControl(f.adapter,{scopeId,timeoutMs:30});assert.equal(result.reason,'TIMEOUT');
});
test('invalid service options and incomplete adapters are rejected before calls',async()=>{
 for(const opts of [{},{scopeId:''},{scopeId:' x'},{scopeId:'x'.repeat(97)},{scopeId,timeoutMs:0},{scopeId,timeoutMs:30001},{scopeId,timeoutMs:NaN},{scopeId,timeoutMs:null},{scopeId,extra:1}])await assert.rejects(probeDeviceControl(fixture().adapter,opts),error=>error.code==='INVALID_OPTIONS');
 await assert.rejects(probeDeviceControl({},options),error=>error.code==='INVALID_ADAPTER');
 assert.throws(()=>createUnsupportedDeviceControlAdapter(''),error=>error.code==='INVALID_OPTIONS');
});
test('rules allowing use do not imply device control when the adapter is unsupported',async()=>{
 const state=freshGuardian(),text=encodeGuardianLifecycle(state);let reads=0;
 const store={read:async()=>{reads++;return text;},compareAndSwap(){throw Error('No writes permitted');}};
 const result=await readGuardedUsageView(store,createUnsupportedDeviceControlAdapter(scopeId),options);
 assert.equal(result.rules.phase,'AVAILABLE');assert.equal(result.expectedRestriction,'released');assert.equal(result.device.status,'unsupported');assert.equal(result.consistent,false);assert.equal(reads,2);assert.equal(await store.read(),text);
});
test('all blocked business phases require a restricted observation',async()=>{
 const initial=freshGuardian();const challenge=step(initial,'record_usage',{seconds:1800}),quiz=beginGuardian(initial),failed=answerGuardian(quiz,true),rest=answerGuardian(quiz),daily=step(initial,'record_usage',{seconds:7200});
 for(const state of [challenge,quiz,failed,rest,observeGuardian(rest),daily])for(const restricted of [true,false]){
  const f=fixture(capabilities(),observation({state:restricted?'restricted':'released'}));const result=await readGuardedUsageView(storeFor(state),f.adapter,options);assert.equal(result.expectedRestriction,'restricted');assert.equal(result.consistent,restricted);assert.equal(result.device.deviceControlValidated,false);
 }
});
test('available rules paired with a still-restricted device expose a mismatch',async()=>{
 for(const state of ['restricted','released']){const {adapter}=fixture(capabilities(),observation({state}));const result=await readGuardedUsageView(storeFor(freshGuardian()),adapter,options);assert.equal(result.consistent,state==='released');}
});
test('ledger changes while querying device state reject the stale view',async()=>{
 const first=freshGuardian(),second=step(first,'record_usage',{seconds:7200});let current=encodeGuardianLifecycle(first);
 const f=fixture();f.adapter.getRestrictionStatus=()=>{current=encodeGuardianLifecycle(second);return observation();};
 await assert.rejects(readGuardedUsageView({read:async()=>current},f.adapter,options),error=>error.code==='LIFECYCLE_CHANGED');assert.equal(current,encodeGuardianLifecycle(second));
});
test('corrupt or unavailable ledgers are never reset or treated as available',async()=>{
 for(const store of [{read:async()=>'{broken'}, {read:async()=>{throw Error('private-store-detail');}}])await assert.rejects(readGuardedUsageView(store,fixture().adapter,options),error=>error instanceof DeviceControlError&&!error.message.includes('private-store-detail')&&['INVALID_LIFECYCLE','STORE_FAILURE'].includes(error.code));
 await assert.rejects(readGuardedUsageView({},fixture().adapter,options),error=>error.code==='INVALID_STORE');
});
test('the complete view read times out even when the store never responds',async()=>{
 await assert.rejects(readGuardedUsageView({read:()=>new Promise(()=>{})},fixture().adapter,{scopeId,timeoutMs:20}),error=>error.code==='TIMEOUT');
});
test('a synchronous adapter response arriving after the deadline is not treated as timely',async()=>{
 const f=fixture();f.adapter.getCapabilities=()=>{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);return capabilities();};
 const result=await probeDeviceControl(f.adapter,{scopeId,timeoutMs:5});assert.equal(result.status,'failed');assert.equal(result.reason,'TIMEOUT');
});
