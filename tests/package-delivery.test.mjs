import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync,rmSync,symlinkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('../',import.meta.url);
test('whole delivery archive has reproducible checked content, matching sources and honest capabilities',()=>{
 const directory=mkdtempSync(join(tmpdir(),'beaa-delivery-test-')),out=join(directory,'delivery');
 try{
  const build=()=>execFileSync('python3',['scripts/package-delivery.py','--output',out],{cwd:root,encoding:'utf8'});
  build();const first=readFileSync(out+'.zip');build();assert.deepEqual(readFileSync(out+'.zip'),first);
  const result=execFileSync('python3',['-c',`
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
from hashlib import sha256
import json,sys
with ZipFile(sys.argv[1]+'.zip') as z:
 assert z.testzip() is None
 names=set(z.namelist())
 for name in ['web/index.html','beaa-browser-check.html','beaa-source.zip','DELIVERY_GUIDE.md','DEVICE_POC.md','DEVICE_ACCEPTANCE_RECORD_TEMPLATE.md','manifest.json','SHA256SUMS']:
  assert 'BEAA-delivery/'+name in names,name
 rows=z.read('BEAA-delivery/SHA256SUMS').decode().splitlines()
 assert len(rows)==len(names)-1
 for line in rows:
  digest,name=line.split('  ')
  assert sha256(z.read('BEAA-delivery/'+name)).hexdigest()==digest
 manifest=json.loads(z.read('BEAA-delivery/manifest.json'))
 assert manifest['nativeBuildValidated'] is False and manifest['deviceControlValidated'] is False and manifest['healthOutcomeValidated'] is False
 assert manifest['testsExecutedByPackager'] is False
 assert manifest['testEvidence']=='BEAA/docs/testing/CROSS_PLATFORM_COMPLETION_REPORT.md'
 assert z.read('BEAA-delivery/web/index.html')==Path('apps/web-preview/index.html').read_bytes()
 with ZipFile(BytesIO(z.read('BEAA-delivery/beaa-source.zip'))) as source:
  assert source.read('BEAA/apps/web-preview/index.html')==z.read('BEAA-delivery/web/index.html')
  assert source.read('BEAA/apps/harmony/entry/src/main/resources/rawfile/beaa-preview.html')==z.read('BEAA-delivery/web/index.html')
  assert 'BEAA/shared/domain/temporary-access.mjs' in source.namelist()
  for name in ['apps/family-service/service.mjs','apps/ios/BEAA/TransferMigration.swift','apps/harmony/entry/src/main/ets/services/NativeLearning.ts','shared/quiz/curriculum/generated/curriculum.draft.json','docs/testing/CROSS_PLATFORM_COMPLETION_REPORT.md']:
   assert source.read('BEAA/'+name)==Path(name).read_bytes(),name
  assert 'BEAA/apps/harmony/entry/src/main/ets/services/NativeSummary.ts' in source.namelist()
  assert 'BEAA/apps/harmony/entry/src/main/ets/services/ReminderDelivery.ts' in source.namelist()
  assert not any(n.lower().endswith(('.sqlite3','.db','.pem','.p12','.pfx','.key')) or '/local-data/' in n or '/device-logs/' in n for n in source.namelist())
print('delivery consumer verification passed')
`,out],{cwd:root,encoding:'utf8'});assert.match(result,/delivery consumer verification passed/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('delivery refuses to overwrite an unrelated output directory',()=>{
 const directory=mkdtempSync(join(tmpdir(),'beaa-delivery-foreign-')),out=join(directory,'delivery');
 try{mkdirSync(out);writeFileSync(join(out,'keep.txt'),'private');const result=spawnSync('python3',['scripts/package-delivery.py','--output',out],{cwd:root,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/Unrelated output directory/);assert.equal(readFileSync(join(out,'keep.txt'),'utf8'),'private');}
 finally{rmSync(directory,{recursive:true,force:true});}
});

test('delivery refuses an output archive symlink without changing the target',()=>{
 const directory=mkdtempSync(join(tmpdir(),'beaa-delivery-link-')),out=join(directory,'delivery'),privateFile=join(directory,'private.txt');
 try{execFileSync('python3',['scripts/package-delivery.py','--output',out],{cwd:root});writeFileSync(privateFile,'keep');unlinkSync(out+'.zip');symlinkSync(privateFile,out+'.zip');const result=spawnSync('python3',['scripts/package-delivery.py','--output',out],{cwd:root,encoding:'utf8'});assert.notEqual(result.status,0);assert.equal(readFileSync(privateFile,'utf8'),'keep');}
 finally{rmSync(directory,{recursive:true,force:true});}
});
