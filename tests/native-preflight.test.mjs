import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectNativePrerequisites } from '../scripts/native-preflight.mjs';

const missing = () => ({ available:false, reason:'not_found', version:null });
const installed = () => ({ available:true, reason:null, version:'4.0.2' });

test('native preflight lists missing tools and SDK without claiming build readiness',()=>{
 const report=inspectNativePrerequisites({probe:missing,directoryExists:()=>false,environment:{}});
 assert.equal(report.status,'blocked');
 assert.deepEqual(report.missing,['java','ohpm','hvigor','sdk']);
 assert.equal(report.buildAttempted,false);assert.equal(report.deviceVerified,false);
});

test('an unset or nonexistent SDK binding cannot satisfy native prerequisites',()=>{
 const report=inspectNativePrerequisites({probe:installed,directoryExists:()=>false,environment:{DEVECO_SDK_HOME:'/missing-sdk'}});
 assert.equal(report.sdk.configured,true);assert.equal(report.sdk.available,false);
 assert.deepEqual(report.missing,['sdk']);assert.equal(JSON.stringify(report).includes('/missing-sdk'),false);
});

test('available prerequisites never imply successful compilation or device validation',()=>{
 const report=inspectNativePrerequisites({probe:installed,directoryExists:p=>p==='/sdk',sdkPath:'/sdk',environment:{}});
 assert.equal(report.status,'prerequisites_detected');assert.deepEqual(report.missing,[]);
 assert.equal(report.buildAttempted,false);assert.equal(report.deviceVerified,false);
 assert.equal(report.sdk.source,'argument');
});

test('failed required version commands block while missing hdc is optional',()=>{
 const probe=name=>name==='ohpm'?{available:false,reason:'version_command_failed',version:null}:name==='hdc'?missing():installed();
 const report=inspectNativePrerequisites({probe,directoryExists:()=>true,environment:{OHOS_SDK_HOME:'/sdk'}});
 assert.deepEqual(report.missing,['ohpm']);assert.equal(report.tools.hdc.required,false);
 assert.equal(report.sdk.source,'OHOS_SDK_HOME');
});

test('SDK discovery uses an existing binding after a stale earlier binding',()=>{
 const report=inspectNativePrerequisites({probe:installed,directoryExists:path=>path==='/valid-sdk',environment:{DEVECO_SDK_HOME:'/stale-sdk',OHOS_SDK_HOME:'/valid-sdk'}});
 assert.equal(report.sdk.source,'OHOS_SDK_HOME');assert.equal(report.status,'prerequisites_detected');
});

test('an explicit SDK argument never silently falls back to another binding',()=>{
 const report=inspectNativePrerequisites({probe:installed,directoryExists:path=>path==='/valid-sdk',sdkPath:'/missing-explicit-sdk',environment:{OHOS_SDK_HOME:'/valid-sdk'}});
 assert.equal(report.sdk.source,'argument');assert.equal(report.status,'blocked');
});

test('preflight CLI distinguishes detected prerequisites, bad arguments and missing tools',async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {fileURLToPath}=await import('node:url');const {spawnSync}=await import('node:child_process');
 const directory=mkdtempSync(join(tmpdir(),'beaa-native-cli-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const bin=join(directory,'bin'),sdk=join(directory,'sdk');mkdirSync(bin);mkdirSync(sdk);
 const suffix=process.platform==='win32'?'.cmd':'';
 for(const name of ['java','ohpm','hvigor','hdc'])writeFileSync(join(bin,name+suffix),process.platform==='win32'?'@echo 4.0.2\r\n':"#!/bin/sh\nprintf '4.0.2\\n'\n",{mode:0o755});
 const script=fileURLToPath(new URL('../scripts/native-preflight.mjs',import.meta.url));
 const run=args=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{...process.env,PATH:bin}});
 const detected=run(['--sdk',sdk]);assert.equal(detected.status,0,detected.stderr);
 assert.equal(JSON.parse(detected.stdout).buildAttempted,false);assert.equal(detected.stdout.includes(sdk),false);
 assert.equal(run(['--invalid']).status,1);
 rmSync(join(bin,'hvigor'+suffix));const blocked=run(['--sdk',sdk]);assert.equal(blocked.status,2);
 assert.deepEqual(JSON.parse(blocked.stdout).missing,['hvigor']);
});
