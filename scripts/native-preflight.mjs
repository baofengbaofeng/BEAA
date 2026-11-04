import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const commands={java:['-version'],ohpm:['--version'],hvigor:['--version'],hdc:['-v']};
const sdkBindings=['DEVECO_SDK_HOME','HARMONYOS_SDK_HOME','OHOS_SDK_HOME'];

function probeCommand(name) {
  const result=spawnSync(name,commands[name],{encoding:'utf8',timeout:10000,windowsHide:true,shell:process.platform==='win32'});
  const available=!result.error && result.status===0;
  const reason=available?null:result.error?.code==='ENOENT'?'not_found':result.error?.code==='ETIMEDOUT'?'timeout':'version_command_failed';
  // Retain version metadata only, never arbitrary CLI output or environment values.
  const version=available?(`${result.stdout || ''}\n${result.stderr || ''}`.match(/\b\d+(?:\.\d+){1,3}\b/)?.[0] || null):null;
  return {available,reason,version};
}
function isDirectory(path) {try{return statSync(path).isDirectory();}catch{return false;}}

export function inspectNativePrerequisites({probe=probeCommand,directoryExists=isDirectory,environment=process.env,sdkPath=null}={}) {
  const configured=sdkBindings.filter(name=>typeof environment[name]==='string' && environment[name].trim());
  const source=sdkPath?'argument':configured.find(name=>directoryExists(environment[name])) || configured[0] || null;
  const selected=sdkPath || (source?environment[source]:null);
  const sdk={configured:!!selected,source,available:!!selected && directoryExists(selected),contentsVerified:false};
  const tools=Object.fromEntries(Object.keys(commands).map(name=>[name,{...probe(name),required:name!=='hdc'}]));
  const missing=Object.entries(tools).filter(([,tool])=>tool.required && !tool.available).map(([name])=>name);
  if(!sdk.available)missing.push('sdk');
  return {schemaVersion:1,status:missing.length?'blocked':'prerequisites_detected',tools,sdk,missing,
    compatibilityVerified:false,buildAttempted:false,signingVerified:false,deviceVerified:false};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.length && !(args.length===2 && args[0]==='--sdk' && args[1])) {
    console.error('Usage: node scripts/native-preflight.mjs [--sdk <directory>]');
    process.exitCode=1;
  } else {
    const report=inspectNativePrerequisites({sdkPath:args[1] || null});
    console.log(JSON.stringify(report,null,2));
    process.exitCode=report.status==='blocked'?2:0;
  }
}
