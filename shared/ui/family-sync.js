// Explicitly opted-in device client; browser storage remains an editable demonstration boundary.
const beaaFamily = (()=>{
 const key='beaa-family-connection-v1';let busy=false;let status='家庭连接默认关闭';
 const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
 const policyKeys=['period','dailyLimit','rest','grade','questionCount','requiredCorrect','subject','topic'];
 const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 function validPolicy(p){return p&&Object.keys(p).length===8&&Object.keys(p).every(k=>policyKeys.includes(k))&&integer(p.period,5,120)&&integer(p.dailyLimit,15,600)&&p.period<=p.dailyLimit&&integer(p.rest,0,60)&&integer(p.grade,1,6)&&integer(p.questionCount,1,20)&&integer(p.requiredCorrect,1,p.questionCount)&&['all','math','chinese','english'].includes(p.subject)&&['all','arithmetic','poetry','vocabulary'].includes(p.topic);}
 function read(){try{const c=JSON.parse(localStorage.getItem(key)||'null');return c&&typeof c.base==='string'&&typeof c.token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(c.token)&&uuid(c.deviceID)&&Array.isArray(c.receipts)?c:null;}catch{return null;}}
 function write(c){localStorage.setItem(key,JSON.stringify(c));}
 function summary(){return {revision:s.stateRevision,usedSeconds:s.dailyUsed*60+s.dailyRemainderSeconds,answeredCount:s.history.reduce((n,r)=>n+r.total,0),correctCount:s.history.reduce((n,r)=>n+r.correct,0),policy:Object.fromEntries(policyKeys.map(k=>[k,s[k]]))};}
 async function applyCommand(command){return withStateLock(()=>{
  syncState();let connection=read();const result=reason=>({applied:reason==='applied',revision:s.stateRevision,reason});
  if(!connection||recoveryBlocked||storageError)return result('blocked');
  if(!command||!uuid(command.id)||command.targetDeviceID!==connection.deviceID)return result('invalid');
  const saved=connection.receipts.find(r=>r.id===command.id);if(saved)return saved.result;
  const now=Date.now();let reason='applied';
  if(!integer(command.issuedAt,0,Number.MAX_SAFE_INTEGER)||!integer(command.expiresAt,0,Number.MAX_SAFE_INTEGER)||command.expiresAt<=command.issuedAt||command.expiresAt-command.issuedAt>300000||now<command.issuedAt||now>=command.expiresAt)reason='expired';
  else if(command.expectedRevision!==s.stateRevision)reason='stale';
  else if(!['requestSummary','setPolicy','emergencyGrant','endGrant'].includes(command.kind))reason='invalid';
  else if(command.kind==='setPolicy'&&(!validPolicy(command.policy)||['answering','rest'].includes(s.phase)))reason='blocked';
  else if(command.kind==='emergencyGrant'&&(!integer(command.minutes,1,30)||s.phase!=='challenge'||s.emergencyGrant?.closedReason===null||quietStatus().blocked||command.minutes*60>permitContext().dailyRemainingSeconds))reason='blocked';
  // Consume before business mutation. A crash may reject an unconfirmed action, never apply twice.
  connection.receipts=connection.receipts.filter(r=>r.at>now-604800000);
  if(connection.receipts.length>=2000)return result('blocked');
  const receipt={id:command.id,at:now,result:result(reason==='applied'?'blocked':reason)};
  connection.receipts.push(receipt);try{write(connection);}catch{return result('blocked');}
  if(reason==='applied'){
   const before=JSON.stringify(s),beforeSaved=lastSaved;
   try{
    if(!clock())throw Error('clock');
    if(command.kind==='setPolicy'){
     for(const k of policyKeys)s[k]=command.policy[k];
     s.phase=s.dailyUsed>=s.dailyLimit?'daily':s.cycleUsed>=s.period?'challenge':'available';
     observePermit();audit('settings');
    }else if(command.kind==='emergencyGrant'){
     if(s.phase!=='challenge'||quietStatus().blocked)throw Error('blocked');
     s.emergencyGrant=createTemporaryAccess({permitId:hex(crypto.getRandomValues(new Uint8Array(12))),minutes:command.minutes},{...permitContext(),phase:'AVAILABLE',cycleRemainingSeconds:1800});audit('emergency_issue',{minutes:command.minutes});
    }else if(command.kind==='endGrant'){
     if(s.emergencyGrant)s.emergencyGrant=closeTemporaryAccess(s.emergencyGrant,now);
     if(s.permit){closeTemporaryAccess(s.permit,now);s.permit=null;}audit('emergency_end');
    }
    if(command.kind!=='requestSummary'&&!save())throw Error('storage');
   }catch{s=lastSaved===beforeSaved?JSON.parse(before):restore(lastSaved);reason='blocked';}
  }
  receipt.result=result(reason);try{write(connection);}catch{return result('blocked');}
  render();return receipt.result;
 });}
 function baseURL(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!['https:','http:'].includes(u.protocol)||u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('url');return u.origin;}
 async function request(c,path,body){const r=await fetch(c.base+'/v1/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(c.token?{Authorization:'Bearer '+c.token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('request');return r.json();}
 async function poll(){if(busy||typeof fetch!=='function')return;const c=read();if(!c)return;busy=true;try{c.base=baseURL(c.base);if(recoveryBlocked||storageError)throw Error('storage');await request(c,'summary',summary());for(const saved of (read()?.receipts||[])){if(read()?.token!==c.token)break;if(!saved.acked&&saved.at>Date.now()-604800000){await request(c,'ack',{id:saved.id,...saved.result});const fresh=read();if(fresh?.token===c.token){const found=fresh.receipts.find(r=>r.id===saved.id);if(found)found.acked=true;write(fresh);}}}const commands=await request(c,'pending');if(!Array.isArray(commands)||commands.length>200)throw Error('input');for(const command of commands){if(read()?.token!==c.token)break;const receipt=await applyCommand(command);await request(c,'ack',{id:command.id,...receipt});const fresh=read();if(fresh?.token===c.token){const saved=fresh.receipts.find(r=>r.id===command.id);if(saved)saved.acked=true;write(fresh);}}if(read()?.token===c.token){await request(c,'summary',summary());status='家庭连接已检查，设备用时仍为模拟数据';}}catch{status='家庭连接未完成，原有学习进度保持；请检查网络、服务与配对';}finally{busy=false;document.getElementById('family-connection-status')?.replaceChildren(document.createTextNode(status));}}
 function field(parent,title,type='text'){const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');input.type=type;input.setAttribute('aria-label',title);label.append(input);parent.append(label);return input;}
 function button(parent,title,fn){const b=document.createElement('button');b.textContent=title;b.type='button';b.addEventListener('click',e=>{e.stopPropagation();Promise.resolve().then(fn).catch(()=>{status='操作未完成，请检查家长授权、服务地址和配对码';document.getElementById('family-connection-status')?.replaceChildren(document.createTextNode(status));});});parent.append(b);}
 function paragraph(parent,text){const p=document.createElement('p');p.textContent=text;parent.append(p);return p;}
 async function loadCourse(index){return withStateLock(()=>{
  syncState();if(!authorized()||recoveryBlocked||storageError||['answering','rest'].includes(s.phase))return false;
  const packs=typeof beaaCoursePacks==='object'?beaaCoursePacks:[],pack=packs[index];if(!pack)return false;
  const before=JSON.stringify(s),beforeSaved=lastSaved;
  try{const bank=validateBank(pack.questions);s.bank=bank;s.grade=pack.grade;s.subject=pack.subject;s.topic='all';s.questionCount=Math.min(5,bank.length);s.requiredCorrect=s.questionCount;audit('import');if(!save())throw Error('storage');render();return true;}
  catch{s=lastSaved===beforeSaved?JSON.parse(before):restore(lastSaved);return false;}
 });}
 function mount(){const root=document.getElementById('family-sync-panel');if(!root||root.dataset.mounted)return;root.dataset.mounted='true';paragraph(root,'家庭连接与课程练习');paragraph(root,'默认不上传。仅填写你信任的家庭服务地址与单次配对码后开启；连接只分享脱敏摘要与明确指令，不上传密码、题目、答案或本机账本。家长长口令只在独立家长端输入。');
  const url=field(root,'家庭服务地址');url.placeholder='https://family.example';url.value=read()?.base||'';
  const code=field(root,'十分钟单次配对码','password');const name=field(root,'设备名称');name.value='学习设备';
  const output=paragraph(root,status);output.id='family-connection-status';output.setAttribute('aria-live','polite');
  button(root,'确认配对并开启连接',async()=>{if(!authorized())return;const base=baseURL(url.value);const result=await request({base},'join',{code:code.value,name:name.value});code.value='';if(!authorized()||!uuid(result.deviceID)||!/^[A-Za-z0-9_-]{43}$/.test(result.token))return;write({base,deviceID:result.deviceID,token:result.token,receipts:[]});status='已配对';await poll();});
  button(root,'关闭本机连接',()=>{if(!authorized())return;localStorage.removeItem(key);status='本机家庭连接已关闭';output.textContent=status;});button(root,'立即检查家庭连接',()=>{if(authorized())return poll();});
  const packs=typeof beaaCoursePacks==='object'?beaaCoursePacks:[];if(packs.length){paragraph(root,'课程覆盖练习草稿，尚待教师审核，不代表完整课程。选择练习包会替换当前题库并调整年级、学科和题数，原有使用累计保持。');const select=document.createElement('select');select.setAttribute('aria-label','分级课程练习包');for(let i=0;i<packs.length;i++){const option=document.createElement('option');option.value=i;option.textContent=packs[i].label+' · 待审核';select.append(option);}root.append(select);button(root,'载入选中的课程草稿',async()=>{if(!await loadCourse(Number(select.value)))throw Error('import');});}
 }
 if(typeof window!=='undefined'&&typeof document.createElement==='function'){
  window.beaaFamilyPort=Object.freeze({getSummary:summary,applyCommand});
  const observer=new MutationObserver(()=>mount());observer.observe(document.getElementById('app'),{childList:true,subtree:true});mount();setInterval(poll,30000);if(read())poll();
 }
 return Object.freeze({getSummary:summary,applyCommand,loadCourse});
})();
