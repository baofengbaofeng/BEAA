import { randomBytes,createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invokePythonWorker } from './python-worker.mjs';
const WORKER=fileURLToPath(new URL('./parent_auth_worker.py',import.meta.url));
const TTL=300000,MAX_SESSIONS=16;
const MESSAGES={INVALID_PIN:'PIN must contain 6 to 12 ASCII digits',INVALID_REQUEST:'Invalid parent authentication request',
  PARENT_PIN_INVALID:'PIN verification failed',PARENT_LOCKED:'Verification is temporarily locked',PARENT_UNAUTHORIZED:'Parent authorization required',
  PARENT_EXPIRED:'Parent authorization expired',PARENT_REVOKED:'Parent authorization revoked',PARENT_CLOCK_ERROR:'Trusted monotonic clock unavailable or discontinuous',
  PARENT_VERSION_EXHAUSTED:'Credential version exhausted',ALREADY_EXISTS:'Credential database already exists',STORE_MISSING:'Credential database missing',
  CORRUPT_AUTH_STORE:'Credential database is inconsistent',UNSUPPORTED_AUTH_STORE:'Unsupported credential database',UNSAFE_STORAGE:'Private owned storage is required',
  UNSUPPORTED_PLATFORM:'Reference authentication requires Linux and Python 3.11+',STORE_BUSY:'Credential transaction is busy',STORE_IO:'Credential operation failed',
  BACKEND_UNAVAILABLE:'Credential backend unavailable',STORE_TIMEOUT:'Credential operation timed out',PROTOCOL_ERROR:'Invalid credential backend response'};
export class ParentAuthError extends Error {
  constructor(code){super(MESSAGES[code]??MESSAGES.PROTOCOL_ERROR);this.name='ParentAuthError';this.code=Object.hasOwn(MESSAGES,code)?code:'PROTOCOL_ERROR';}
}
function check(ok,code){if(!ok)throw new ParentAuthError(code);}
function pin(value){check(typeof value==='string' && /^[0-9]{6,12}$/.test(value),'INVALID_PIN');}
function scope(value){return typeof value==='string' && value.length>0 && value.length<=96 && value.trim()===value && Buffer.from(value,'utf8').toString('utf8')===value;}
function identity(value){
  check(value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===2 && scope(value.lifecycleId) && Number.isSafeInteger(value.credentialVersion) && value.credentialVersion>=1,'CORRUPT_AUTH_STORE');
  return {lifecycleId:value.lifecycleId,credentialVersion:value.credentialVersion};
}
function configuration(path,options){
  check(typeof path==='string' && path.length>0 && !path.includes('\0') && options && typeof options==='object' && !Array.isArray(options) && Object.keys(options).every(k=>['python','clock'].includes(k)),'INVALID_REQUEST');
  const python=options.python??'python3',clock=options.clock??(()=>performance.now());
  check(typeof python==='string' && python.trim().length>0 && !python.includes('\0') && typeof clock==='function','INVALID_REQUEST');return {path:resolve(path),python,clock};
}
async function request(config,message){try{return await invokePythonWorker(WORKER,config.path,config.python,message);}catch(error){throw new ParentAuthError(error.code);}}
const tokenKey=token=>createHash('sha256').update(token,'utf8').digest('hex');
function service(config,boundIdentity){
  const sessions=new Map();let lastNow=-1;
  function now(){
    let value;try{value=config.clock();}catch{sessions.clear();throw new ParentAuthError('PARENT_CLOCK_ERROR');}
    if(!Number.isFinite(value) || value<lastNow || value<0 || value>Number.MAX_SAFE_INTEGER-TTL){sessions.clear();throw new ParentAuthError('PARENT_CLOCK_ERROR');}
    lastNow=value;return value;
  }
  function find(token){
    const time=now();check(typeof token==='string' && /^[A-Za-z0-9_-]{43}$/.test(token),'PARENT_UNAUTHORIZED');
    const key=tokenKey(token),session=sessions.get(key);check(session,'PARENT_UNAUTHORIZED');
    if(time>=session.expires){sessions.delete(key);throw new ParentAuthError('PARENT_EXPIRED');}return {key,session};
  }
  async function authorize(token){
    const {key,session}=find(token),current=identity(await request(config,{operation:'status'}));
    const checked=find(token);check(checked.session===session && sessions.get(key)===session,'PARENT_UNAUTHORIZED');
    if(current.lifecycleId!==session.lifecycleId || current.credentialVersion!==session.credentialVersion){sessions.delete(key);throw new ParentAuthError('PARENT_REVOKED');}
    return current;
  }
  return {
    async login(value){
      pin(value);const result=await request(config,{operation:'login',pin:value});
      check(result && ['accepted','invalid','locked'].includes(result.status),'PROTOCOL_ERROR');
      if(result.status!=='accepted')throw new ParentAuthError(result.status==='locked'?'PARENT_LOCKED':'PARENT_PIN_INVALID');
      const verified=identity(result.identity);check(verified.lifecycleId===boundIdentity.lifecycleId,'CORRUPT_AUTH_STORE');
      const time=now(),token=randomBytes(32).toString('base64url');
      while(sessions.size>=MAX_SESSIONS)sessions.delete(sessions.keys().next().value);
      sessions.set(tokenKey(token),{...verified,expires:time+TTL});return {token,expiresInSeconds:TTL/1000};
    },
    authorize,
    logout(token){return typeof token==='string'?sessions.delete(tokenKey(token)):false;},
    async changePin(token,value){
      const grant=await authorize(token);pin(value);
      const updated=identity(await request(config,{operation:'change_pin',expectedVersion:grant.credentialVersion,pin:value}));
      check(updated.lifecycleId===grant.lifecycleId && updated.credentialVersion===grant.credentialVersion+1,'PROTOCOL_ERROR');sessions.clear();return updated;
    }
  };
}
export async function createParentAuthService(path,lifecycleId,value,options={}){
  pin(value);check(scope(lifecycleId),'INVALID_REQUEST');const config=configuration(path,options);
  const created=identity(await request(config,{operation:'initialize',lifecycleId,pin:value}));return service(config,created);
}
export async function openParentAuthService(path,options={}){
  const config=configuration(path,options);return service(config,identity(await request(config,{operation:'status'})));
}
