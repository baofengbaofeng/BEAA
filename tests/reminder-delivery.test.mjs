import test from 'node:test';
import assert from 'node:assert/strict';
import {loadNativeCore} from './helpers/native-core.mjs';
const {ReminderDelivery,createReminderQueue,validateReminderQueue,validateReminderSnapshot}=loadNativeCore(['ReminderDelivery']);
function fixture(){
 const f={now:1000000,authorization:'authorized',calls:[],visible:new Map(),value:createReminderQueue('family'),source:{version:1,scopeId:'family',revision:0,cycle:0,dayKey:'2026-11-06',phase:'AVAILABLE',cycleRemainingSeconds:1800,dailyRemainingSeconds:7200,simulated:true}};
 f.store={read:async()=>f.value,compareAndSwap:async(scope,revision,text)=>{const q=JSON.parse(f.value);if(q.scopeId!==scope||q.revision!==revision)return false;f.value=text;return true;}};
 f.reader={read:async()=>JSON.stringify(f.source)};
 f.port={authorization:async()=>f.authorization,publish:async(id,kind,rule)=>{f.calls.push(['publish',id,kind,rule]);f.visible.set(id,kind);},cancel:async id=>{f.calls.push(['cancel',id]);f.visible.delete(id);}};
 f.worker=(owner='worker-1',timeoutMs=100)=>new ReminderDelivery(f.store,f.reader,f.port,{scopeId:'family',ownerId:owner,nowMs:()=>f.now,timeoutMs});
 f.set=(remaining,extra={})=>{f.source={...f.source,revision:f.source.revision+1,cycleRemainingSeconds:remaining,...extra};};
 return f;
}
test('current five/one/expiry reminders replace older ones with stable non-reused IDs',async()=>{
 const f=fixture(),w=f.worker();assert.equal((await w.pump()).status,'idle');f.set(300);assert.equal((await w.pump()).status,'submitted');assert.equal((await w.pump()).status,'idle');f.set(299);await w.pump();assert.equal(f.calls.filter(c=>c[0]==='publish').length,1);
 f.set(60);await w.pump();assert.deepEqual([...f.visible.entries()],[[2,'one_minute']]);f.set(0,{phase:'CHALLENGE_REQUIRED'});await w.pump();assert.deepEqual([...f.visible.entries()],[[3,'time_up']]);f.set(0,{phase:'CHALLENGE_ACTIVE'});await w.pump();assert.equal(f.visible.size,0);assert.equal(JSON.parse(f.value).nextId,4);
});
test('daily hard limit wins ties and non-available learning/rest stages never get usage reminders',async()=>{
 const f=fixture();f.set(300,{dailyRemainingSeconds:300});await f.worker().pump();assert.equal(f.calls[0][3],'daily_limit');f.set(0,{dailyRemainingSeconds:0,phase:'DAILY_LOCKED'});await f.worker().pump();assert.equal(f.visible.get(2),'time_up');f.set(0,{phase:'REST_REQUIRED'});await f.worker().pump();assert.equal(f.visible.size,0);
});
test('reopening suppresses already published reminders but a new cycle gets a fresh ID',async()=>{
 const f=fixture();f.set(300);await f.worker().pump();await f.worker('restart').pump();assert.equal(f.calls.filter(c=>c[0]==='publish').length,1);f.set(300,{cycle:1});await f.worker('restart').pump();assert.equal(f.visible.get(2),'five_minutes');assert(!f.visible.has(1));
});
test('denied permission holds pending work and revocation cleans visible messages',async()=>{
 const f=fixture();f.authorization='denied';f.set(300);assert.equal((await f.worker().pump()).status,'denied');assert.equal(f.visible.size,0);f.authorization='authorized';await f.worker().pump();assert.equal(f.visible.size,1);f.authorization='denied';assert.equal((await f.worker().pump()).status,'denied');assert.equal(f.visible.size,0);
});
test('publish failure persists exponential retry state without exporting adapter errors',async()=>{
 const f=fixture();f.set(300);let attempts=0;f.port.publish=async(id,kind)=>{attempts++;if(attempts===1)throw Error('private-token-path');f.visible.set(id,kind);};const w=f.worker();const r=await w.pump();assert.equal(r.status,'retry_pending');assert(!JSON.stringify(r).includes('private'));await w.pump();assert.equal(attempts,1);f.now+=1000;assert.equal((await w.pump()).status,'submitted');assert.equal(attempts,2);assert.equal(JSON.parse(f.value).items[0].id,1);
});
test('failed stale cancellation stays pending and is retried before publishing newer work',async()=>{
 const f=fixture(),w=f.worker();f.set(300);await w.pump();f.set(60);let fail=true;const cancel=f.port.cancel;f.port.cancel=async id=>{if(fail)throw Error('hidden');return cancel(id);};assert.equal((await w.pump()).status,'cleanup_pending');assert.equal(f.visible.size,1);assert.equal(JSON.parse(f.value).items[0].status,'cancel_pending');fail=false;f.now+=1000;await w.pump();assert.deepEqual([...f.visible.entries()],[[2,'one_minute']]);
});
test('a phase or permission change during publish cancels the result and never marks it submitted',async()=>{
 for(const change of ['phase','permission']){const f=fixture();f.set(300);const publish=f.port.publish;f.port.publish=async(...args)=>{await publish(...args);if(change==='phase')f.set(0,{phase:'CHALLENGE_ACTIVE'});else f.authorization='denied';};const r=await f.worker().pump();assert.notEqual(r.status,'submitted');assert.equal(f.visible.size,0);assert.equal(JSON.parse(f.value).items[0].status,'cancelled');}
});
test('same-instance and cross-instance pumps respect a sending lease',async()=>{
 const f=fixture();f.set(300);let release,started;const start=new Promise(resolve=>started=resolve),publish=f.port.publish;f.port.publish=async(...args)=>{started();await new Promise(resolve=>release=resolve);await publish(...args);};const first=f.worker('one').pump();await start;assert.equal((await f.worker('two').pump()).status,'busy');release();assert.equal((await first).status,'submitted');assert.equal(f.calls.filter(c=>c[0]==='publish').length,1);
 const w=f.worker('same');await Promise.all([w.pump(),w.pump()]);assert.equal(f.calls.filter(c=>c[0]==='publish').length,1);
});
test('an abandoned sending lease is recovered with the original ID after restart',async()=>{
 const f=fixture();f.set(300);const read=f.reader.read;let reads=0;f.reader.read=async()=>{if(++reads===2)throw Error('process interrupted');return read();};await assert.rejects(f.worker('dead').pump());assert.equal(JSON.parse(f.value).items[0].status,'sending');f.reader.read=read;f.now+=30001;assert.equal((await f.worker('new').pump()).status,'submitted');assert.equal(f.calls[0][1],1);
});
test('a committed but unacknowledged publication receipt survives a re-read',async()=>{
 const f=fixture();f.set(300);const cas=f.store.compareAndSwap;let lost=false;f.store.compareAndSwap=async(...args)=>{const ok=await cas(...args);if(ok&&!lost&&JSON.parse(args[2]).items.some(i=>i.status==='published')){lost=true;throw Error('lost acknowledgement');}return ok;};await assert.rejects(f.worker().pump(),e=>e.code==='STORE_FAILURE');assert.equal((await f.worker('restart').pump()).status,'idle');assert.equal(f.calls.filter(c=>c[0]==='publish').length,1);
});
test('clock rollback cleans old messages and source rollback never resets the queue watermark',async()=>{
 const f=fixture();f.set(300);await f.worker().pump();const saved=f.value;f.source.revision=0;await assert.rejects(f.worker().pump(),e=>e.code==='SOURCE_ROLLBACK');assert.equal(f.value,saved);f.source.revision=1;f.now--;assert.equal((await f.worker().pump()).status,'clock_error');assert.equal(f.visible.size,0);f.now+=2;assert.equal((await f.worker().pump()).status,'idle');
});
test('strict snapshots reject private fields, wrong scope, corrupt queues and fake device validation',async()=>{
 const f=fixture();for(const extra of [{simulated:false},{scopeId:''},{phase:'unknown'},{revision:-1},{cycleRemainingSeconds:0},{pinHash:'secret'}])assert.throws(()=>validateReminderSnapshot(JSON.stringify({...f.source,...extra})));
 for(const text of ['null','{broken',JSON.stringify({...JSON.parse(f.value),version:99})])assert.throws(()=>validateReminderQueue(text));f.source.scopeId='other';await assert.rejects(f.worker().pump(),e=>e.code==='SCOPE_MISMATCH');
});
test('a timed-out publish is retired and its eventual late completion is cancelled',async()=>{
 const f=fixture();f.set(300);let release;const publish=f.port.publish;f.port.publish=(...args)=>new Promise(resolve=>release=async()=>{await publish(...args);resolve();});const r=await f.worker('one',5).pump();assert.equal(r.status,'unconfirmed');assert.equal(JSON.parse(f.value).items[0].status,'cancelled');await release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.visible.size,0);assert(f.calls.filter(c=>c[0]==='cancel').length>=2);
});
test('a concurrent cancellation while publication receipt CAS conflicts cannot report submitted',async()=>{
 const f=fixture();f.set(300);const cas=f.store.compareAndSwap;let race=false;
 f.store.compareAndSwap=async(scope,revision,text)=>{if(!race&&JSON.parse(text).items.some(i=>i.status==='published')){race=true;const q=JSON.parse(f.value);q.revision++;q.items[0].status='cancel_pending';f.value=JSON.stringify(q);return false;}return cas(scope,revision,text);};
 assert.notEqual((await f.worker().pump()).status,'submitted');assert.equal(f.visible.size,0);
});
test('source revision rollback during publication is treated as an unconfirmed current state',async()=>{
 const f=fixture();f.set(300);const publish=f.port.publish;f.port.publish=async(...args)=>{await publish(...args);f.source.revision=0;};assert.notEqual((await f.worker().pump()).status,'submitted');assert.equal(f.visible.size,0);
});
test('late publish cleanup still cancels the OS message when queue storage is temporarily unavailable',async()=>{
 const f=fixture();f.set(300);let release;const publish=f.port.publish;f.port.publish=(...args)=>new Promise(resolve=>release=async()=>{await publish(...args);resolve();});await f.worker('one',5).pump();f.store.read=async()=>{throw Error('offline');};await release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.visible.size,0);
});
test('an explicit pause cancels reminders without reading a missing source or resetting the watermark',async()=>{
 const f=fixture(),w=f.worker();f.set(300);await w.pump();const revision=JSON.parse(f.value).sourceRevision;f.reader.read=async()=>{throw Error('web page unavailable');};assert.equal((await w.pause()).status,'paused');assert.equal(f.visible.size,0);assert.equal(JSON.parse(f.value).sourceRevision,revision);
});
test('pause preserves never-published work for revalidation instead of manufacturing a delivery receipt',async()=>{
 const f=fixture(),w=f.worker();f.set(300);f.authorization='denied';await w.pump();await w.pause();assert.equal(JSON.parse(f.value).items[0].status,'pending');f.authorization='authorized';assert.equal((await w.pump()).status,'submitted');
});
test('idle polling and repeated pauses do not rewrite the durable outbox',async()=>{
 const f=fixture(),w=f.worker();await w.pump();const idle=f.value;f.now+=1000;await w.pump();assert.equal(f.value,idle);await w.pause();assert.equal(f.value,idle);f.set(300);await w.pump();await w.pause();const stopped=f.value;await w.pause();assert.equal(f.value,stopped);
});
test('a lease taken by another worker before publish does not let the old owner publish or cancel its receipt',async()=>{
 const f=fixture();f.set(300);const read=f.reader.read;let reads=0;
 f.reader.read=async()=>{if(++reads===2){const q=JSON.parse(f.value);q.revision++;q.items[0].leaseOwner='new';f.value=JSON.stringify(q);await f.worker('new').pump();}return read();};
 await f.worker('old').pump();assert.equal(f.calls.filter(c=>c[0]==='publish').length,1);assert.deepEqual([...f.visible.entries()],[[1,'five_minutes']]);
});
test('losing a lease after a current publish preserves the shared valid notification',async()=>{
 const f=fixture();f.set(300);const publish=f.port.publish;f.port.publish=async(...args)=>{await publish(...args);const q=JSON.parse(f.value);q.revision++;q.items[0].leaseOwner='new';f.value=JSON.stringify(q);};const r=await f.worker('old').pump();assert.equal(r.status,'unconfirmed');assert.equal(f.visible.get(1),'five_minutes');
});
test('late completion after a timeout does not cancel a still-current notification owned by a newer worker',async()=>{
 const f=fixture();f.set(300);let release;f.port.publish=(id,kind)=>{const q=JSON.parse(f.value);q.revision++;q.items[0].leaseOwner='new';f.value=JSON.stringify(q);f.visible.set(id,kind);return new Promise(resolve=>release=resolve);};assert.equal((await f.worker('old',5).pump()).status,'unconfirmed');assert.equal(f.visible.get(1),'five_minutes');release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.visible.get(1),'five_minutes');
});
test('a timeout whose retirement write fails still cleans its own late publication',async()=>{
 const f=fixture();f.set(300);let release;const cas=f.store.compareAndSwap;f.store.compareAndSwap=async(...args)=>{if(JSON.parse(args[2]).items.some(i=>i.inFlight))throw Error('write unavailable');return cas(...args);};f.port.publish=(id,kind)=>new Promise(resolve=>release=()=>{f.visible.set(id,kind);resolve();});await assert.rejects(f.worker('one',5).pump(),e=>e.code==='STORE_FAILURE');release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.visible.size,0);
});
test('a failed publish acknowledgement is cancelled when source changes, permission is lost or the host pauses',async()=>{
 for(const action of ['phase','permission','pause']){const f=fixture(),w=f.worker();f.set(300);f.port.publish=async(id,kind)=>{f.visible.set(id,kind);throw Error('ack lost after side effect');};assert.equal((await w.pump()).status,'retry_pending');if(action==='pause')await w.pause();else{if(action==='phase')f.set(0,{phase:'CHALLENGE_ACTIVE'});else f.authorization='denied';await w.pump();}assert.equal(f.visible.size,0,action);assert.equal(JSON.parse(f.value).items[0].status,'cancelled');}
});
test('failed cleanup of an applied but rejected publish remains durably pending',async()=>{
 const f=fixture(),w=f.worker();f.set(300);f.port.publish=async(id,kind)=>{f.visible.set(id,kind);throw Error('unknown acknowledgement');};await w.pump();const cancel=f.port.cancel;f.port.cancel=async()=>{throw Error('cancel failed');};f.set(0,{phase:'CHALLENGE_ACTIVE'});assert.equal((await w.pump()).status,'cleanup_pending');assert.equal(JSON.parse(f.value).items[0].status,'cancel_pending');f.port.cancel=cancel;f.now+=1000;await w.pump();assert.equal(f.visible.size,0);
});
test('a refreshed claim after CAS conflict respects another worker persisted retry deadline',async()=>{
 const f=fixture();f.set(300);let publishes=0,raced=false;f.port.publish=async()=>{publishes++;throw Error('submission failed');};const cas=f.store.compareAndSwap;f.store.compareAndSwap=async(...args)=>{if(!raced&&JSON.parse(args[2]).items.some(i=>i.status==='sending')){raced=true;await f.worker('other').pump();return false;}return cas(...args);};assert.equal((await f.worker('first').pump()).status,'retry_pending');assert.equal(publishes,1);assert.equal(JSON.parse(f.value).items[0].retryAtMs,1001000);
});
test('a stale publish whose cancellation fails reports cleanup pending instead of cancelled',async()=>{
 const f=fixture();f.set(300);const publish=f.port.publish;f.port.publish=async(...args)=>{await publish(...args);f.set(0,{phase:'CHALLENGE_ACTIVE'});};f.port.cancel=async()=>{throw Error('no cancellation acknowledgement');};assert.equal((await f.worker().pump()).status,'cleanup_pending');assert.equal(f.visible.size,1);assert.equal(JSON.parse(f.value).items[0].status,'cancel_pending');
});
