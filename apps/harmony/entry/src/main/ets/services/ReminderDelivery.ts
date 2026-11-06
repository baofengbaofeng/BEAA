export interface ReminderSnapshot {
 version:number; scopeId:string; revision:number; cycle:number; dayKey:string; phase:string;
 cycleRemainingSeconds:number; dailyRemainingSeconds:number; simulated:boolean;
}
export interface ReminderItem {
 key:string; id:number; cycle:number; dayKey:string; kind:string; limitingRule:string; status:string;
 attempts:number; cancelAttempts:number; retryAtMs:number; leaseOwner:string; leaseUntilMs:number; inFlight:boolean;
}
export interface ReminderQueue {
 version:number; scopeId:string; revision:number; sourceRevision:number; nextId:number; lastClockMs:number; items:ReminderItem[];
}
export interface ReminderQueueStore { read():Promise<string>; compareAndSwap(scopeId:string,revision:number,text:string):Promise<boolean>; }
export interface ReminderSource { read():Promise<string>; }
export interface ReminderNotificationPort {
 authorization():Promise<string>; publish(id:number,kind:string,limitingRule:string):Promise<void>; cancel(id:number):Promise<void>;
}
export interface ReminderOptions { scopeId:string; ownerId:string; nowMs:()=>number; timeoutMs:number; }
export interface ReminderResult { status:string; advisoryOnly:boolean; nativeDeliveryValidated:boolean; }
const PHASES=['AVAILABLE','CHALLENGE_REQUIRED','CHALLENGE_ACTIVE','REST_REQUIRED','DAILY_LOCKED','PAUSED'];
const KINDS=['five_minutes','one_minute','time_up'];
const STATUSES=['pending','sending','published','cancel_pending','cancelled'];
const MAX_ID=2147483647;
export class ReminderDeliveryError extends Error {
 constructor(public code:string){super('Reminder delivery rejected: '+code);this.name='ReminderDeliveryError';}
}
function check(ok:boolean,code:string):void {if(!ok)throw new ReminderDeliveryError(code);}
function integer(n:number,max:number=Number.MAX_SAFE_INTEGER):boolean {return Number.isSafeInteger(n)&&n>=0&&n<=max;}
function id(s:string):boolean {return typeof s==='string'&&s.length>0&&s.length<=96&&s.trim()===s;}
function day(s:string):boolean {try{return typeof s==='string'&&/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}catch{return false;}}
function fields(v:Object,keys:string[],code:string):void {check(v!==null&&typeof v==='object'&&!Array.isArray(v),code);const actual=Object.keys(v);check(actual.length===keys.length&&actual.every(key=>keys.includes(key)),code);}
function keyFor(scope:string,cycle:number,date:string,kind:string,rule:string):string {return JSON.stringify([scope,cycle,date,kind,rule]);}
export function validateReminderSnapshot(text:string):ReminderSnapshot {
 const code='INVALID_SOURCE';check(typeof text==='string'&&text.length<=4000,code);let s:ReminderSnapshot;
 try{s=JSON.parse(text);}catch{throw new ReminderDeliveryError(code);}
 fields(s,['version','scopeId','revision','cycle','dayKey','phase','cycleRemainingSeconds','dailyRemainingSeconds','simulated'],code);
 check(s.version===1&&id(s.scopeId)&&integer(s.revision)&&integer(s.cycle)&&day(s.dayKey)&&PHASES.includes(s.phase)&&s.simulated===true,code);
 check(integer(s.cycleRemainingSeconds,36000)&&integer(s.dailyRemainingSeconds,36000),code);
 check(s.phase!=='AVAILABLE'||s.cycleRemainingSeconds>0&&s.dailyRemainingSeconds>0,code);
 check(s.phase!=='CHALLENGE_REQUIRED'||s.cycleRemainingSeconds===0&&s.dailyRemainingSeconds>0,code);
 check(s.phase!=='DAILY_LOCKED'||s.dailyRemainingSeconds===0,code);return s;
}
export function validateReminderQueue(text:string):ReminderQueue {
 const code='INVALID_QUEUE';check(typeof text==='string'&&text.length<=500000,code);let q:ReminderQueue;
 try{q=JSON.parse(text);}catch{throw new ReminderDeliveryError(code);}
 fields(q,['version','scopeId','revision','sourceRevision','nextId','lastClockMs','items'],code);
 check(q.version===1&&id(q.scopeId)&&integer(q.revision)&&(q.sourceRevision===-1||integer(q.sourceRevision))&&integer(q.nextId,MAX_ID+1)&&q.nextId>0&&integer(q.lastClockMs)&&Array.isArray(q.items)&&q.items.length<=512,code);
 let previous=0;const keys:string[]=[];
 q.items.forEach(item=>{
  fields(item,['key','id','cycle','dayKey','kind','limitingRule','status','attempts','cancelAttempts','retryAtMs','leaseOwner','leaseUntilMs','inFlight'],code);
  check(integer(item.id,MAX_ID)&&item.id>previous&&item.id<q.nextId&&integer(item.cycle)&&day(item.dayKey)&&KINDS.includes(item.kind)&&['cycle','daily_limit'].includes(item.limitingRule)&&STATUSES.includes(item.status),code);previous=item.id;
  check(item.key===keyFor(q.scopeId,item.cycle,item.dayKey,item.kind,item.limitingRule)&&!keys.includes(item.key),code);keys.push(item.key);
  check(integer(item.attempts)&&integer(item.cancelAttempts)&&integer(item.retryAtMs)&&integer(item.leaseUntilMs)&&typeof item.inFlight==='boolean'&&typeof item.leaseOwner==='string'&&(item.leaseOwner===''||id(item.leaseOwner)),code);
  check(item.status!=='sending'||id(item.leaseOwner)&&item.leaseUntilMs>0,code);
 });return q;
}
export function createReminderQueue(scopeId:string):string {
 check(id(scopeId),'INVALID_OPTIONS');return JSON.stringify({version:1,scopeId,revision:0,sourceRevision:-1,nextId:1,lastClockMs:0,items:[]});
}
function desiredKind(s:ReminderSnapshot):string {
 if(s.phase==='CHALLENGE_REQUIRED'||s.phase==='DAILY_LOCKED')return 'time_up';
 if(s.phase!=='AVAILABLE')return '';
 const left=Math.min(s.cycleRemainingSeconds,s.dailyRemainingSeconds);return left<=60?'one_minute':left<=300?'five_minutes':'';
}
function desiredKey(s:ReminderSnapshot):string {
 const kind=desiredKind(s);return kind===''?'':keyFor(s.scopeId,s.cycle,s.dayKey,kind,s.dailyRemainingSeconds<=s.cycleRemainingSeconds?'daily_limit':'cycle');
}
function result(status:string):ReminderResult {return {status,advisoryOnly:true,nativeDeliveryValidated:false};}
export class ReminderDelivery {
 private tail:Promise<void>=Promise.resolve();
 private observedClockMs:number=0;
 constructor(private store:ReminderQueueStore,private source:ReminderSource,private port:ReminderNotificationPort,private options:ReminderOptions){
  check(id(options.scopeId)&&id(options.ownerId)&&typeof options.nowMs==='function'&&integer(options.timeoutMs,30000)&&options.timeoutMs>0,'INVALID_OPTIONS');
 }
 pause():Promise<ReminderResult>{const work=this.tail.then(()=>this.runPause());this.tail=work.then(()=>{},()=>{});return work;}
 private async runPause():Promise<ReminderResult>{
  let written=false;
  for(let attempt=0;attempt<8;attempt++){const q=await this.read(),before=JSON.stringify(q);q.items.forEach(item=>{if(item.status==='sending'||item.status==='published'||item.inFlight&&item.status!=='cancel_pending'){item.status='cancel_pending';item.retryAtMs=0;}});if(JSON.stringify(q)===before||await this.write(q)){written=true;break;}}
  check(written,'CONFLICT');const q=await this.read();for(const item of q.items.filter(entry=>entry.status==='cancel_pending'))if(item.retryAtMs>this.now()||!await this.cancel(item))return result('cleanup_pending');return result('paused');
 }
 pump():Promise<ReminderResult>{const work=this.tail.then(()=>this.run());this.tail=work.then(()=>{},()=>{});return work;}
 private now():number {const n=this.options.nowMs();check(integer(n,Number.MAX_SAFE_INTEGER-60000),'CLOCK_ERROR');return n;}
 private timed<T>(work:Promise<T>,late?:()=>void):Promise<T>{
  return new Promise<T>((resolve,reject)=>{let finished=false;const timer=setTimeout(()=>{finished=true;reject(new ReminderDeliveryError('TIMEOUT'));},this.options.timeoutMs);
   work.then(value=>{if(finished){if(late)late();return;}finished=true;clearTimeout(timer);resolve(value);},()=>{if(finished){if(late)late();return;}finished=true;clearTimeout(timer);reject(new ReminderDeliveryError('PORT_FAILURE'));});
  });
 }
 private async read():Promise<ReminderQueue>{let text:string;try{text=await this.timed(this.store.read());}catch{throw new ReminderDeliveryError('STORE_FAILURE');}const q=validateReminderQueue(text);check(q.scopeId===this.options.scopeId,'SCOPE_MISMATCH');return q;}
 private async snapshot():Promise<ReminderSnapshot>{let text:string;try{text=await this.timed(this.source.read());}catch{throw new ReminderDeliveryError('SOURCE_UNAVAILABLE');}const s=validateReminderSnapshot(text);check(s.scopeId===this.options.scopeId,'SCOPE_MISMATCH');return s;}
 private async authorization():Promise<string>{try{const status=await this.timed(this.port.authorization());return ['authorized','denied','unsupported'].includes(status)?status:'unknown';}catch{return 'unknown';}}
 private async write(q:ReminderQueue):Promise<boolean>{
  const revision=q.revision;check(revision<Number.MAX_SAFE_INTEGER,'COUNTER_EXHAUSTED');q.revision++;q.lastClockMs=Math.max(q.lastClockMs,this.observedClockMs,this.now());this.observedClockMs=q.lastClockMs;
  const text=JSON.stringify(q);validateReminderQueue(text);let ok:boolean;
  try{ok=await this.timed(this.store.compareAndSwap(q.scopeId,revision,text));}catch{throw new ReminderDeliveryError('STORE_FAILURE');}
  check(typeof ok==='boolean','STORE_FAILURE');return ok;
 }
 private async update(itemId:number,change:(item:ReminderItem)=>void):Promise<void>{
  for(let attempt=0;attempt<8;attempt++){const q=await this.read(),item=q.items.find(entry=>entry.id===itemId);check(item!==undefined,'ITEM_MISSING');change(item!);if(await this.write(q))return;}
  throw new ReminderDeliveryError('CONFLICT');
 }
 private retry(item:ReminderItem,now:number,attempts:number=item.attempts):void {
  check(item.attempts<Number.MAX_SAFE_INTEGER,'COUNTER_EXHAUSTED');item.retryAtMs=now+Math.min(60000,1000*Math.pow(2,Math.min(6,Math.max(0,attempts-1))));item.leaseOwner='';item.leaseUntilMs=0;
 }
 private async cancel(item:ReminderItem):Promise<boolean>{
  try{await this.timed(this.port.cancel(item.id));}
  catch{await this.update(item.id,current=>{current.status='cancel_pending';check(current.cancelAttempts<Number.MAX_SAFE_INTEGER,'COUNTER_EXHAUSTED');current.cancelAttempts++;this.retry(current,this.now(),current.cancelAttempts);});return false;}
  await this.update(item.id,current=>{current.status='cancelled';current.leaseOwner='';current.leaseUntilMs=0;current.retryAtMs=0;});return true;
 }
 private async cancelLate(itemId:number,sentAttempts:number):Promise<void>{
  try{const q=await this.read(),item=q.items.find(entry=>entry.id===itemId);if(item&&!item.inFlight&&(item.status==='published'||item.status==='sending'&&(item.leaseOwner!==this.options.ownerId||item.attempts>sentAttempts))&&await this.current(item.key))return;}catch{}
  let cancelled=false;try{await this.timed(this.port.cancel(itemId));cancelled=true;}catch{cancelled=false;}
  try{await this.update(itemId,item=>{item.inFlight=false;item.status=cancelled?'cancelled':'cancel_pending';item.leaseOwner='';item.leaseUntilMs=0;if(!cancelled)this.retry(item,this.now(),item.cancelAttempts+1);});}catch{ /* An inFlight record remains retained for future cleanup. */ }
 }
 private async current(key:string):Promise<boolean>{const s=await this.snapshot(),q=await this.read();return this.now()>=Math.max(q.lastClockMs,this.observedClockMs)&&s.revision>=q.sourceRevision&&desiredKey(s)===key&&await this.authorization()==='authorized';}
 private async run():Promise<ReminderResult>{
  let q:ReminderQueue,s:ReminderSnapshot,auth='',clockBack=false,currentKey='';let reconciled=false;
  for(let attempt=0;attempt<8;attempt++){
   q=await this.read();s=await this.snapshot();check(s.revision>=q.sourceRevision,'SOURCE_ROLLBACK');auth=await this.authorization();const before=JSON.stringify(q),now=this.now();clockBack=now<Math.max(q.lastClockMs,this.observedClockMs);this.observedClockMs=Math.max(this.observedClockMs,now);currentKey=clockBack?'':desiredKey(s);
   q.sourceRevision=s.revision;
   q.items.forEach(item=>{
    if(item.inFlight&&item.status==='cancelled'){item.status='cancel_pending';item.retryAtMs=0;}
    if(item.key!==currentKey){if(item.status==='pending')item.status='cancelled';else if(item.status==='published'||item.status==='sending'){item.status='cancel_pending';item.retryAtMs=0;}}
    else if(auth!=='authorized'&&(item.status==='published'||item.status==='sending')){item.status='cancel_pending';item.retryAtMs=0;}
   });
   if(currentKey!==''&&!q.items.some(item=>item.key===currentKey)){
    check(q.nextId<=MAX_ID,'COUNTER_EXHAUSTED');q.items.push({key:currentKey,id:q.nextId++,cycle:s.cycle,dayKey:s.dayKey,kind:desiredKind(s),limitingRule:s.dailyRemainingSeconds<=s.cycleRemainingSeconds?'daily_limit':'cycle',status:'pending',attempts:0,cancelAttempts:0,retryAtMs:0,leaseOwner:'',leaseUntilMs:0,inFlight:false});
   }
   const ended=q.items.filter(item=>item.status==='cancelled'&&!item.inFlight),remove=ended.slice(0,Math.max(0,ended.length-256)).map(item=>item.id);q.items=q.items.filter(item=>!remove.includes(item.id));check(q.items.length<=512,'QUEUE_FULL');
   if(JSON.stringify(q)===before||await this.write(q)){reconciled=true;break;}
  }
  check(reconciled,'CONFLICT');q=await this.read();
  for(const item of q.items.filter(entry=>entry.status==='cancel_pending')){
   if(item.retryAtMs>this.now()||!await this.cancel(item))return result('cleanup_pending');
  }
  if(clockBack)return result('clock_error');if(auth!=='authorized')return result(auth);
  q=await this.read();let item=q.items.find(entry=>entry.key===currentKey);
  if(!item||item.status==='published'||item.status==='cancelled')return result('idle');
  if(item.retryAtMs>this.now())return result('retry_pending');
  let claimed=false;
  for(let attempt=0;attempt<8;attempt++){
   q=await this.read();item=q.items.find(entry=>entry.key===currentKey);
   if(!item||!['pending','sending'].includes(item.status))return result('idle');
   if(item.retryAtMs>this.now())return result('retry_pending');
   if(item.status==='sending'&&item.leaseOwner!==this.options.ownerId&&item.leaseUntilMs>this.now())return result('busy');
   item.status='sending';item.leaseOwner=this.options.ownerId;item.leaseUntilMs=this.now()+30000;check(item.attempts<Number.MAX_SAFE_INTEGER,'COUNTER_EXHAUSTED');item.attempts++;
   if(await this.write(q)){claimed=true;break;}
  }
  check(claimed&&item!==undefined,'CONFLICT');const sending=item!;
  if(!await this.current(sending.key)){await this.update(sending.id,entry=>{entry.status='cancel_pending';});return result(await this.cancel(sending)?'cancelled':'cleanup_pending');}
  const lease=(await this.read()).items.find(entry=>entry.id===sending.id);
  if(lease?.status==='published')return result('idle');
  if(!lease||lease.status!=='sending'||lease.leaseOwner!==this.options.ownerId||lease.leaseUntilMs<=this.now())return result('busy');
  try{await this.timed(this.port.publish(sending.id,sending.kind,sending.limitingRule),()=>{void this.cancelLate(sending.id,sending.attempts);});}
  catch(error){
   const timeout=error instanceof ReminderDeliveryError&&error.code==='TIMEOUT';
   let retired=false;
   await this.update(sending.id,entry=>{retired=false;if(entry.status==='sending'&&entry.leaseOwner===this.options.ownerId){entry.status=timeout?'cancel_pending':'sending';entry.inFlight=timeout;retired=timeout;this.retry(entry,this.now());if(!timeout){entry.leaseOwner=this.options.ownerId;entry.leaseUntilMs=entry.retryAtMs;}}});
   if(timeout){if(retired||!await this.current(sending.key))await this.cancel(sending);return result('unconfirmed');}return result('retry_pending');
  }
  let stillCurrent=false;try{stillCurrent=await this.current(sending.key);}catch{stillCurrent=false;}
  if(!stillCurrent){await this.update(sending.id,entry=>{entry.status='cancel_pending';});return result(await this.cancel(sending)?'cancelled':'cleanup_pending');}
  let accepted=false;
  await this.update(sending.id,entry=>{accepted=entry.status==='published';if(entry.status==='sending'&&entry.leaseOwner===this.options.ownerId){entry.status='published';entry.leaseOwner='';entry.leaseUntilMs=0;entry.retryAtMs=0;accepted=true;}});
  if(!accepted){const latest=(await this.read()).items.find(entry=>entry.id===sending.id);if(latest?.status==='sending'&&latest.leaseOwner!==this.options.ownerId&&await this.current(sending.key))return result('unconfirmed');return result(await this.cancel(sending)?'cancelled':'cleanup_pending');}return result('submitted');
 }
}
