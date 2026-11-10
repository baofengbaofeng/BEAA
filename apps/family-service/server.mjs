import {createServer} from 'node:http';
import {readFileSync,openSync,writeFileSync,closeSync,unlinkSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {FamilyService} from './service.mjs';
export function createFamilyServer({service,origins=[]}){
 const allowed=new Set(origins);
 return createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  const origin=req.headers.origin;
  const ownOrigin=/^(?:127\.0\.0\.1|localhost):[0-9]+$/.test(req.headers.host??'')&&origin==='http://'+req.headers.host;
  if(origin&&!allowed.has(origin)&&!ownOrigin)return send(403,{error:'origin_rejected'});
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.writeHead(204);return res.end();}
  const path=req.url?.split('?')[0];
  if(req.method==='GET'&&['/','/parent.html','/pinyin.js','/reading.js'].includes(path)){
   const file=path==='/pinyin.js'?new URL('../../node_modules/pinyin-pro/dist/index.js',import.meta.url):path==='/reading.js'?new URL('../../shared/ui/pinyin-ui.js',import.meta.url):new URL('./parent.html',import.meta.url);
   try {res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'"});return res.end(readFileSync(file));}catch{return res.end();}
  }
  if(req.method!=='GET'&&req.method!=='POST')return send(405,{error:'method_rejected'});
  let bytes=0,parts=[];
  try {
   if(req.method==='POST'){for await(const chunk of req){bytes+=chunk.length;if(bytes>32768)return send(413,{error:'too_large'});parts.push(chunk);}}
   const body=parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')):{};
   const bearer=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization??'')?.[1];
   let result;
   if(req.method==='POST'&&path==='/v1/login')result=service.login(body.password);
   else if(req.method==='POST'&&path==='/v1/logout')result=service.logout(bearer);
   else if(req.method==='POST'&&path==='/v1/pairs')result=service.createPair(bearer);
   else if(req.method==='POST'&&path==='/v1/join')result=service.join(body.code,body.name);
   else if(req.method==='POST'&&path==='/v1/summary')result=service.publish(bearer,body);
   else if(req.method==='GET'&&path==='/v1/devices')result=service.devices(bearer);
   else if(req.method==='GET'&&path==='/v1/pending')result=service.pending(bearer);
   else if(req.method==='POST'&&path==='/v1/commands'){const {deviceID,...command}=body;result=service.enqueue(bearer,deviceID,command);}
   else if(req.method==='POST'&&path==='/v1/ack'){const {id,...receipt}=body;result=service.acknowledge(bearer,id,receipt);}
   else if(req.method==='POST'&&path==='/v1/revoke')result=service.revoke(bearer,body.deviceID);
   else return send(404,{error:'not_found'});
   return send(200,result??{ok:true});
  }catch{return send(403,{error:'request_rejected'});}
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.BEAA_FAMILY_PORT??8787);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
 const path=resolve(process.env.BEAA_FAMILY_STORE??'local-data/family.enc');
 // Exclusive process ownership; stale locks require operator inspection instead of silent takeover.
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const lock=path+'.server.lock',fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));
 process.on('exit',()=>{try{closeSync(fd);unlinkSync(lock);}catch{}});
 const service=new FamilyService({path,key:Buffer.from(process.env.BEAA_FAMILY_STORE_KEY??'','base64'),password:process.env.BEAA_PARENT_PASSWORD??''});
 const server=createFamilyServer({service,origins:(process.env.BEAA_FAMILY_ORIGINS??`http://127.0.0.1:${port},http://localhost:${port}`).split(',').map(x=>x.trim()).filter(Boolean)});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
 server.listen(port,'127.0.0.1',()=>process.stdout.write(`Family service listening on 127.0.0.1:${port}; no remote deployment performed.\n`));
}
