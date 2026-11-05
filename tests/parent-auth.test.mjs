import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ParentAuthError,createParentAuthService,openParentAuthService } from '../apps/node-reference/parent-auth.mjs';
const PIN='482619',NEW_PIN='739152',scope='family-ledger-1';
const denied=(fn,code)=>assert.rejects(fn,e=>e instanceof ParentAuthError && (!code || e.code===code));
async function fixture(fn,options={}){
 const directory=mkdtempSync(join(tmpdir(),'beaa-parent-')),path=join(directory,'parent.sqlite3');
 try{const auth=await createParentAuthService(path,scope,PIN,options);await fn({auth,path,directory});}finally{rmSync(directory,{recursive:true,force:true});}
}
function db(path,sql){return JSON.parse(execFileSync('python3',['-c',"import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); r=c.execute(sys.argv[2]).fetchall(); c.commit(); c.close(); print(json.dumps(r))",path,sql],{encoding:'utf8'}));}

test('PIN uses independent random salts and never stores plaintext or sessions',async()=>{
 await fixture(async({auth,path,directory})=>{
  const other=join(directory,'second.sqlite3');await createParentAuthService(other,scope,PIN);
  const first=db(path,'SELECT length(salt),length(digest),hex(salt),hex(digest),credential_version FROM parent_auth')[0],second=db(other,'SELECT hex(salt),hex(digest) FROM parent_auth')[0];
  assert.equal(first[0],16);assert.equal(first[1],32);assert.equal(first[4],1);assert.notEqual(first[2],second[0]);assert.notEqual(first[3],second[1]);
  const login=await auth.login(PIN);assert.match(login.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(login.expiresInSeconds,300);
  assert.deepEqual(await auth.authorize(login.token),{lifecycleId:scope,credentialVersion:1});
  assert.equal(readFileSync(path).includes(Buffer.from(PIN)),false);assert.equal(readFileSync(path).includes(Buffer.from(login.token)),false);assert.equal(statSync(path).mode&0o777,0o600);
 });
});

test('five failures persist across reopened services and block even the correct PIN',async()=>{
 await fixture(async({auth,path})=>{
  for(let i=0;i<3;i++)await denied(()=>auth.login('000000'),'PARENT_PIN_INVALID');
  const reopened=await openParentAuthService(path);for(let i=0;i<2;i++)await denied(()=>reopened.login('000000'),'PARENT_PIN_INVALID');
  await denied(()=>auth.login(PIN),'PARENT_LOCKED');await denied(()=>reopened.login(PIN),'PARENT_LOCKED');
  assert.equal(db(path,'SELECT failures FROM parent_auth')[0][0],5);
 });
});

test('concurrent failures share one transaction counter rather than resetting attempts',async()=>{
 await fixture(async({auth,path})=>{
  for(let i=0;i<2;i++)await denied(()=>auth.login('000000'),'PARENT_PIN_INVALID');
  const other=await openParentAuthService(path),results=await Promise.allSettled([auth.login('000000'),other.login('000000'),auth.login('000000')]);
  assert.equal(results.filter(r=>r.status==='rejected' && r.reason.code==='PARENT_PIN_INVALID').length,3);
  assert.equal(db(path,'SELECT failures FROM parent_auth')[0][0],5);await denied(()=>auth.login(PIN),'PARENT_LOCKED');
 });
});

test('elapsed cooldown permits a new verification but a new boot rebuilds a locked window',async()=>{
 await fixture(async({auth,path})=>{
  for(let i=0;i<5;i++)await denied(()=>auth.login('000000'),'PARENT_PIN_INVALID');
  // Simulated persisted clock state; no real five-minute sleep or wall-clock jump.
  db(path,"UPDATE parent_auth SET boot_id='previous-boot',last_seen_ms=0,blocked_until_ms=1");
  await denied(()=>auth.login(PIN),'PARENT_LOCKED');const locked=db(path,'SELECT boot_id,last_seen_ms,blocked_until_ms FROM parent_auth')[0];
  assert.notEqual(locked[0],'previous-boot');assert.equal(locked[2]-locked[1],300000);
  db(path,'UPDATE parent_auth SET last_seen_ms=0,blocked_until_ms=1');
  const login=await auth.login(PIN);assert.equal((await auth.authorize(login.token)).credentialVersion,1);assert.equal(db(path,'SELECT failures FROM parent_auth')[0][0],0);
 });
});

test('a persisted monotonic regression locks verification instead of clearing failures',async()=>{
 await fixture(async({auth,path})=>{
  db(path,'UPDATE parent_auth SET last_seen_ms=9007199254740000');await denied(()=>auth.login(PIN),'PARENT_LOCKED');assert.equal(db(path,'SELECT failures FROM parent_auth')[0][0],5);
 });
});

test('short-lived authorization expires on a monotonic clock and never survives service reopening',async()=>{
 let now=1000;await fixture(async({auth,path})=>{
  const {token}=await auth.login(PIN);now=300999;await auth.authorize(token);now=301000;await denied(()=>auth.authorize(token),'PARENT_EXPIRED');
  now=302000;const login=await auth.login(PIN),reopened=await openParentAuthService(path);await denied(()=>reopened.authorize(login.token),'PARENT_UNAUTHORIZED');
 },{clock:()=>now});
});

test('logout and a backwards service clock invalidate in-memory authorization',async()=>{
 let now=1000;await fixture(async({auth})=>{
  const first=await auth.login(PIN);assert.equal(auth.logout(first.token),true);await denied(()=>auth.authorize(first.token),'PARENT_UNAUTHORIZED');
  const second=await auth.login(PIN);now=999;await denied(()=>auth.authorize(second.token),'PARENT_CLOCK_ERROR');now=1001;await denied(()=>auth.authorize(second.token),'PARENT_UNAUTHORIZED');
 },{clock:()=>now});
});

test('changing PIN revokes tokens in this and other service instances',async()=>{
 await fixture(async({auth,path})=>{
  const other=await openParentAuthService(path),first=await auth.login(PIN),second=await other.login(PIN);
  const changed=await auth.changePin(first.token,NEW_PIN);assert.equal(changed.credentialVersion,2);
  await denied(()=>auth.authorize(first.token),'PARENT_UNAUTHORIZED');await denied(()=>other.authorize(second.token),'PARENT_REVOKED');
  await denied(()=>auth.login(PIN),'PARENT_PIN_INVALID');const next=await auth.login(NEW_PIN);assert.equal((await auth.authorize(next.token)).credentialVersion,2);
 });
});

test('session capacity is bounded and the oldest token is revoked',async()=>{
 await fixture(async({auth})=>{
  const first=await auth.login(PIN);for(let i=0;i<16;i++)await auth.login(PIN);
  await denied(()=>auth.authorize(first.token),'PARENT_UNAUTHORIZED');
 });
});

test('invalid PINs, missing or corrupt stores never initialize replacement credentials',async()=>{
 await fixture(async({auth,path,directory})=>{
  for(const pin of ['12345','1234567890123','１２３４５６','abc123',' 482619',null])await denied(()=>auth.login(pin),'INVALID_PIN');
  const token=await auth.login(PIN);await denied(()=>auth.changePin(token.token,'12345'),'INVALID_PIN');await auth.authorize(token.token);
  await denied(()=>createParentAuthService(path,scope,NEW_PIN),'ALREADY_EXISTS');await denied(()=>openParentAuthService(join(directory,'missing.sqlite3')),'STORE_MISSING');
  db(path,"UPDATE parent_auth SET digest=x'00'");await denied(()=>openParentAuthService(path),'CORRUPT_AUTH_STORE');await denied(()=>auth.login(PIN),'CORRUPT_AUTH_STORE');
 });
});

test('logout during asynchronous authorization prevents its pending result',async()=>{
 await fixture(async({auth})=>{
  const {token}=await auth.login(PIN),pending=auth.authorize(token);auth.logout(token);
  await denied(()=>pending,'PARENT_UNAUTHORIZED');
 });
});

test('credential version exhaustion fails without changing the PIN or resetting the store',async()=>{
 await fixture(async({auth,path})=>{
  db(path,'UPDATE parent_auth SET credential_version=9007199254740991');const {token}=await auth.login(PIN);
  await denied(()=>auth.changePin(token,NEW_PIN),'PARENT_VERSION_EXHAUSTED');assert.equal((await auth.authorize(token)).credentialVersion,Number.MAX_SAFE_INTEGER);
 });
});
