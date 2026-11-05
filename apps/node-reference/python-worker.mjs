import { spawn } from 'node:child_process';
const MAX_BYTES=32*1024*1024;
export class PythonWorkerError extends Error {
  constructor(code){super('Python operation failed');this.name='PythonWorkerError';this.code=code;}
}
/** Internal transport: fixed caller-selected script, no shell or raw stderr/secret propagation. */
export function invokePythonWorker(script,path,python,message){
  const input=JSON.stringify(message);
  if(Buffer.byteLength(input,'utf8')>MAX_BYTES)throw new PythonWorkerError('INVALID_REQUEST');
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-B',script,path],{stdio:['pipe','pipe','pipe'],shell:false});let settled=false,bytes=0;const output=[];
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new PythonWorkerError('STORE_TIMEOUT'));},10000);
    child.once('error',()=>finish(new PythonWorkerError('BACKEND_UNAVAILABLE')));child.stdin.on('error',()=>{});child.stderr.resume();
    child.stdout.on('data',part=>{bytes+=part.length;if(bytes>MAX_BYTES){child.kill('SIGKILL');finish(new PythonWorkerError('PROTOCOL_ERROR'));}else output.push(part);});
    child.once('close',code=>{
      if(settled)return;let response;
      try{response=JSON.parse(Buffer.concat(output).toString('utf8'));}catch{return finish(new PythonWorkerError('PROTOCOL_ERROR'));}
      if(!response || typeof response!=='object' || Array.isArray(response))return finish(new PythonWorkerError('PROTOCOL_ERROR'));
      if(response.ok===false && typeof response.code==='string' && /^[A-Z_]{1,64}$/.test(response.code))return finish(new PythonWorkerError(response.code));
      if(code!==0 || response.ok!==true || !Object.hasOwn(response,'value'))return finish(new PythonWorkerError('PROTOCOL_ERROR'));
      finish(null,response.value);
    });child.stdin.end(input);
  });
}
