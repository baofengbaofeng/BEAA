import {decodeGuardianLifecycle,getGuardianView} from './guardian-lifecycle.mjs';

/** SDK-independent, read-only adapter reports. No result proves real device control. */
export class DeviceControlError extends Error {
  constructor(code,message){super(message);this.name='DeviceControlError';this.code=code;}
}
const check=(ok,code,message)=>{if(!ok)throw new DeviceControlError(code,message);};
const supportStates=['supported','unsupported','unknown'];
const authorizationStates=['authorized','unauthorized','revoked','unknown'];
const capabilityKeys=['schemaVersion','scopeId','revision','usage','restriction','authorization'];
const statusKeys=['schemaVersion','scopeId','revision','status'];
function scope(value){return typeof value==='string'&&value.length>0&&value.length<=96&&value.trim()===value;}
function record(value,keys,code='INVALID_RESPONSE'){
  check(value&&typeof value==='object'&&!Array.isArray(value),code,'A plain data record is required');
  const prototype=Object.getPrototypeOf(value),ownKeys=Reflect.ownKeys(value);
  check((prototype===Object.prototype||prototype===null)&&ownKeys.length===keys.length&&ownKeys.every(k=>keys.includes(k)),code,'Unexpected data record fields');
  const captured={};
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);check(descriptor&&Object.hasOwn(descriptor,'value'),code,'Data properties are required');captured[key]=descriptor.value;}
  return captured;
}
function settings(options){
  const keys=['scopeId'];if(options&&Object.hasOwn(options,'timeoutMs'))keys.push('timeoutMs');
  const captured=record(options,keys,'INVALID_OPTIONS'),timeoutMs=Object.hasOwn(captured,'timeoutMs')?captured.timeoutMs:3000;
  check(scope(captured.scopeId)&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=30000,'INVALID_OPTIONS','A scope and a timeout of 1–30000 milliseconds are required');
  return {scopeId:captured.scopeId,timeoutMs};
}
function adapterMethods(adapter){
  check(adapter&&typeof adapter.getCapabilities==='function'&&typeof adapter.getRestrictionStatus==='function','INVALID_ADAPTER','A trusted device status adapter is required');
}
function envelope(value){
  check(value.schemaVersion===1&&scope(value.scopeId)&&Number.isSafeInteger(value.revision)&&value.revision>=0,'INVALID_RESPONSE','Invalid adapter response metadata');
}
function captureCapabilities(value){
  const captured=record(value,capabilityKeys);envelope(captured);
  check(supportStates.includes(captured.usage)&&supportStates.includes(captured.restriction)&&authorizationStates.includes(captured.authorization),'INVALID_RESPONSE','Unknown capability or authorization state');
  return captured;
}
function captureRestriction(value){
  // Read status only as a data property; malformed records cannot run accessors.
  const descriptor=value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,'status'):null;
  const keys=descriptor?.value==='ok'?[...statusKeys,'state']:statusKeys;
  const captured=record(value,keys);envelope(captured);
  check(['ok','unsupported','unauthorized','revoked','failed'].includes(captured.status),'INVALID_RESPONSE','Unknown restriction query result');
  if(captured.status==='ok')check(['restricted','released','unknown'].includes(captured.state),'INVALID_RESPONSE','Unknown restriction state');
  return captured;
}
function result(scopeId,status,reason,capabilities=null,restriction='unknown'){
  return {schemaVersion:1,scopeId,status,reason,capabilities:capabilities?{...capabilities}:null,restriction,evidence:'adapter_report',deviceControlValidated:false};
}
function capabilityGate(caps){
  if(caps.authorization==='revoked')return ['revoked','PERMISSION_REVOKED'];
  if(caps.usage==='unsupported'||caps.restriction==='unsupported')return ['unsupported','CAPABILITY_UNSUPPORTED'];
  if(caps.authorization==='unauthorized')return ['unauthorized','PERMISSION_REQUIRED'];
  if(caps.authorization==='unknown'||caps.usage==='unknown'||caps.restriction==='unknown')return ['unverified','CAPABILITY_UNKNOWN'];
  return null;
}
async function limited(timeoutMs,work){
  let active=true,timer;const endsAt=performance.now()+timeoutMs;
  const guard=()=>check(active&&performance.now()<endsAt,'TIMEOUT','Device status inspection timed out');
  const read=async(fn,failureCode)=>{
    guard();let value;
    try{value=await fn();}catch{guard();throw new DeviceControlError(failureCode,'Unable to read trusted status source');}
    guard();return value;
  };
  const expiration=new Promise((_,reject)=>{timer=setTimeout(()=>{active=false;reject(new DeviceControlError('TIMEOUT','Device status inspection timed out'));},timeoutMs);});
  try{return await Promise.race([Promise.resolve().then(()=>work(read)).then(value=>{guard();return value;}),expiration]);}
  finally{active=false;clearTimeout(timer);}
}
async function inspect(adapter,scopeId,read){
  try{
    const before=captureCapabilities(await read(()=>adapter.getCapabilities(),'ADAPTER_FAILURE'));
    check(before.scopeId===scopeId,'SCOPE_MISMATCH','Adapter belongs to another managed scope');
    const initialGate=capabilityGate(before);if(initialGate)return result(scopeId,...initialGate,before);
    const observed=captureRestriction(await read(()=>adapter.getRestrictionStatus(),'ADAPTER_FAILURE'));
    check(observed.scopeId===scopeId,'SCOPE_MISMATCH','Restriction report belongs to another managed scope');
    if(observed.revision!==before.revision)return result(scopeId,'unverified','CAPABILITIES_CHANGED',before);
    if(observed.status!=='ok')return result(scopeId,observed.status,'RESTRICTION_QUERY_'+observed.status.toUpperCase(),before);
    const after=captureCapabilities(await read(()=>adapter.getCapabilities(),'ADAPTER_FAILURE'));
    check(after.scopeId===scopeId,'SCOPE_MISMATCH','Adapter scope changed during inspection');
    const finalGate=capabilityGate(after);if(finalGate)return result(scopeId,...finalGate,after);
    if(capabilityKeys.some(key=>before[key]!==after[key]))return result(scopeId,'unverified','CAPABILITIES_CHANGED',after);
    return observed.state==='unknown'?result(scopeId,'unverified','RESTRICTION_UNKNOWN',after):result(scopeId,'reported_ready',null,after,observed.state);
  }catch(error){
    if(error instanceof DeviceControlError&&error.code==='TIMEOUT')throw error;
    return result(scopeId,'failed',error instanceof DeviceControlError?error.code:'INVALID_RESPONSE');
  }
}
/** Whole-probe deadline, captured primitive records, no authorization or actuation. */
export async function probeDeviceControl(adapter,options){
  const {scopeId,timeoutMs}=settings(options);adapterMethods(adapter);
  try{return await limited(timeoutMs,read=>inspect(adapter,scopeId,read));}
  catch(error){return result(scopeId,'failed',error instanceof DeviceControlError?error.code:'ADAPTER_FAILURE');}
}
/** Honest fallback until a platform implementation passes the separate device gate. */
export function createUnsupportedDeviceControlAdapter(scopeId){
  check(scope(scopeId),'INVALID_OPTIONS','A managed scope is required');
  const unavailable=async()=>({schemaVersion:1,scopeId,revision:0,status:'unsupported'});
  return {
    getCapabilities:async()=>({schemaVersion:1,scopeId,revision:0,usage:'unsupported',restriction:'unsupported',authorization:'unknown'}),
    requestAuthorization:unavailable,
    async *observeUsage(){throw new DeviceControlError('UNSUPPORTED','Cross-application usage observation is unsupported');},
    restrictApps:unavailable,
    releaseApps:unavailable,
    getRestrictionStatus:unavailable
  };
}
function ruleView(text){
  try{return getGuardianView(decodeGuardianLifecycle(text));}
  catch{throw new DeviceControlError('INVALID_LIFECYCLE','Invalid committed lifecycle snapshot');}
}
/** A diagnostic view, never an authorization to release apps. Store and adapter are trusted dependencies. */
export async function readGuardedUsageView(store,adapter,options){
  const {scopeId,timeoutMs}=settings(options);adapterMethods(adapter);
  check(store&&typeof store.read==='function','INVALID_STORE','A read-only lifecycle store is required');
  return limited(timeoutMs,async read=>{
    const text=await read(()=>store.read(),'STORE_FAILURE'),rules=ruleView(text);
    const device=await inspect(adapter,scopeId,read);
    const current=await read(()=>store.read(),'STORE_FAILURE');ruleView(current);
    check(current===text,'LIFECYCLE_CHANGED','Lifecycle changed during device inspection; read again');
    const expectedRestriction=rules.phase==='AVAILABLE'?'released':'restricted';
    return {rules,device,expectedRestriction,consistent:device.status==='reported_ready'&&device.restriction===expectedRestriction};
  });
}
