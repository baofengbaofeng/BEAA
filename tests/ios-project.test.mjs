import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,appendFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('native project validation preserves local project edits when reporting stale generation',()=>{
 const directory=mkdtempSync(join(tmpdir(),'beaa-ios-project-'));
 try{
  cpSync(new URL('../apps/ios',import.meta.url),directory,{recursive:true});
  const generated=spawnSync('python3',[join(directory,'generate_project.py')],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  const project=join(directory,'BEAA.xcodeproj/project.pbxproj');appendFileSync(project,'\n// local project settings must be preserved\n');const before=readFileSync(project,'utf8');
  const checked=spawnSync('python3',[join(directory,'validate_project.py')],{encoding:'utf8'});assert.notEqual(checked.status,0);assert.equal(readFileSync(project,'utf8'),before);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('connected native project embeds all three extensions and offline resources without changing practice app capabilities',()=>{
 const directory=mkdtempSync(join(tmpdir(),'beaa-ios-connected-'));
 try{
  cpSync(new URL('../apps/ios',import.meta.url),directory,{recursive:true});
  const generated=spawnSync('python3',[join(directory,'generate_project.py')],{encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  const text=readFileSync(join(directory,'BEAA.xcodeproj/project.pbxproj'),'utf8');
  const objects=new Map([...text.matchAll(/^([A-F0-9]{24}) = \{ (.*) \};$/gm)].map(match=>[match[1],match[2]]));
  const target=name=>[...objects.values()].find(body=>body.includes('isa = PBXNativeTarget; name = '+name+';'));
  assert.ok(target('BEAAConnected'),'connected target must be real');assert.ok(target('BEAADeviceActivityMonitor'),'monitor target must be real');
  assert.ok(target('BEAAShieldConfiguration'),'shield configuration must be real');
  assert.ok(target('BEAAShieldAction'),'shield action must be real');
  const phases=body=>[...body.match(/buildPhases = \(([^)]*)\)/)[1].matchAll(/[A-F0-9]{24}/g)].map(match=>objects.get(match[0]));
  assert.ok(phases(target('BEAAConnected')).some(body=>body.includes('PBXCopyFilesBuildPhase')),'connected app must embed extension');
  assert.equal(phases(target('BEAA')).some(body=>body.includes('PBXCopyFilesBuildPhase')),false,'practice app needs no privileged extension');
  assert.ok(text.includes('BEAA/Resources/starter-bank.json'));assert.ok(text.includes('PBXResourcesBuildPhase'));
  assert.ok(readFileSync(join(directory,'BEAA.xcodeproj/xcshareddata/xcschemes/BEAAConnected.xcscheme'),'utf8').includes('BEAAConnected'));
  const validated=spawnSync('python3',[join(directory,'validate_project.py')],{encoding:'utf8'});assert.equal(validated.status,0,validated.stdout+validated.stderr);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
