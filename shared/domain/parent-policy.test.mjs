import test from 'node:test';
import assert from 'node:assert/strict';
import { ParentPolicyError,commitParentPolicyChange } from './parent-policy.mjs';
import { commitGuardianCommand } from './lifecycle-controller.mjs';
import { encodeGuardianLifecycle,decodeGuardianLifecycle,getGuardianView } from './guardian-lifecycle.mjs';
import { freshGuardian,cmd,step } from '../../tests/helpers/guardian-fixture.mjs';
class Store {
 constructor(s){this.text=encodeGuardianLifecycle(s);this.writes=0;this.reads=0;}
 async read(){this.reads++;return this.text;}
 async compareAndSwap(expected,text){const s=decodeGuardianLifecycle(this.text);if(s.lifecycleId!==expected.lifecycleId || s.revision!==expected.revision)return false;this.text=text;this.writes++;return true;}
}
const grant=()=>({lifecycleId:'family-ledger-1',credentialVersion:1});
const auth={authorize:async()=>grant()};
const event=(s,changes={dailyLimitMinutes:60})=>cmd(s,'set_policy',{policy:{...s.policy,...changes}});
const rejects=(fn,code)=>assert.rejects(fn,e=>e instanceof ParentPolicyError && (!code || e.code===code));

test('settings require the parent gateway and unauthorized callers cannot read or write',async()=>{
 const s=freshGuardian(),store=new Store(s),c=event(s);
 await assert.rejects(()=>commitGuardianCommand(store,c),e=>e.code==='PARENT_AUTH_REQUIRED');assert.equal(store.reads,0);
 await rejects(()=>commitParentPolicyChange(store,{authorize:async()=>{throw new Error('secret');}},'opaque',c),'PARENT_UNAUTHORIZED');
 await rejects(()=>commitParentPolicyChange(store,{authorize:async()=>true},'opaque',c),'PARENT_UNAUTHORIZED');assert.equal(store.reads,0);assert.equal(store.writes,0);
 await rejects(()=>commitParentPolicyChange(store,auth,'opaque',cmd(s,'record_usage',{seconds:1})),'INVALID_COMMAND');
});

test('a valid parent writes settings once, receives active status and can retry the receipt',async()=>{
 const s=step(freshGuardian(),'record_usage',{seconds:1200}),store=new Store(s),c=event(s,{dailyLimitMinutes:15});let checks=0;
 const parent={async authorize(){checks++;return grant();}};
 const result=await commitParentPolicyChange(store,parent,'opaque',c);
 assert.equal(checks,2);assert.equal(result.outcome,'committed');assert.equal(result.phase,'DAILY_LOCKED');assert.equal(result.dailySeconds,1200);assert.equal(result.settings.effect,'active');assert.equal(result.settings.activePolicy.dailyLimitMinutes,15);
 const retry=await commitParentPolicyChange(store,parent,'opaque',c);assert.equal(retry.outcome,'duplicate');assert.equal(store.writes,1);
});

test('scope mismatch or a changed credential while reading prevents the policy commit',async()=>{
 const s=freshGuardian(),store=new Store(s),c=event(s);
 await rejects(()=>commitParentPolicyChange(store,{authorize:async()=>({...grant(),lifecycleId:'other'})},'opaque',c),'PARENT_SCOPE_MISMATCH');assert.equal(store.reads,0);
 for(const changed of ['throw','version']){
  let calls=0;const authorizer={async authorize(){calls++;if(calls===2){if(changed==='throw')throw new Error('revoked');return {...grant(),credentialVersion:2};}return grant();}};
  await rejects(()=>commitParentPolicyChange(store,authorizer,'opaque',c),changed==='throw'?'PARENT_UNAUTHORIZED':'PARENT_AUTH_CHANGED');assert.equal(store.writes,0);
 }
});

test('different concurrent parent settings cannot overwrite each other',async()=>{
 const s=freshGuardian(),store=new Store(s),a=event(s,{restMinutes:15}),b={...event(s,{restMinutes:20}),eventId:'different'};
 const result=await Promise.allSettled([commitParentPolicyChange(store,auth,'opaque',a),commitParentPolicyChange(store,auth,'opaque',b)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.filter(r=>r.status==='rejected' && r.reason.code==='CONFLICT').length,1);assert.equal(store.writes,1);
});

test('failure before write preserves rules while a committed lost acknowledgement retries safely',async()=>{
 const s=freshGuardian(),store=new Store(s),before=store.text,c=event(s),cas=store.compareAndSwap.bind(store);
 store.compareAndSwap=async()=>{throw new Error('before-write');};await rejects(()=>commitParentPolicyChange(store,auth,'opaque',c),'STORE_FAILURE');assert.equal(store.text,before);
 store.compareAndSwap=async(...args)=>{await cas(...args);throw new Error('lost-ack');};await rejects(()=>commitParentPolicyChange(store,auth,'opaque',c),'STORE_FAILURE');
 const result=await commitParentPolicyChange(store,auth,'opaque',c);assert.equal(result.outcome,'duplicate');assert.equal(store.writes,1);
});

test('parent command input is captured and private storage is not returned',async()=>{
 const s=freshGuardian(),store=new Store(s),c=event(s);let release,calls=0;
 const authorizer={authorize(){calls++;return calls===1?new Promise(resolve=>{release=()=>resolve(grant());}):Promise.resolve(grant());}};
 const pending=commitParentPolicyChange(store,authorizer,'opaque',c);c.payload.policy.dailyLimitMinutes=15;release();const result=await pending;
 assert.equal(result.settings.activePolicy.dailyLimitMinutes,60);assert.equal(Object.hasOwn(result,'history'),false);assert.equal(Object.hasOwn(result,'stage'),false);
 assert.equal(getGuardianView(decodeGuardianLifecycle(store.text)).dailySeconds,0);
});

test('missing or corrupt storage and invalid policies cannot default to a new session',async()=>{
 const s=freshGuardian(),c=event(s);
 await rejects(()=>commitParentPolicyChange({read:async()=>null,compareAndSwap:async()=>true},auth,'opaque',c),'INVALID_LIFECYCLE');
 const store=new Store(s),bad=event(s,{requiredCorrect:6});await rejects(()=>commitParentPolicyChange(store,auth,'opaque',bad));assert.equal(store.writes,0);
});
