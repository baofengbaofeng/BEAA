import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {execFileSync} from 'node:child_process';
import {buildStarterBank} from '../scripts/package-starter-bank.mjs';
const sourcePath=new URL('../shared/quiz/starter-questions.json',import.meta.url);
const hash=value=>createHash('sha256').update(value).digest('hex');
test('starter artifacts preserve answers, have complete manifests and reproduce without touching source or unrelated files',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'beaa-starter-package-'));try{
  const before=readFileSync(sourcePath);buildStarterBank({sourcePath,outputDirectory:dir});const names=readdirSync(dir).sort();assert.equal(names.length,5);
  const first=Object.fromEntries(names.map(name=>[name,readFileSync(join(dir,name))]));writeFileSync(join(dir,'family-notes.txt'),'keep');await delay(1100);buildStarterBank({sourcePath,outputDirectory:dir});for(const name of names)assert.deepEqual(readFileSync(join(dir,name)),first[name]);assert.equal(readFileSync(join(dir,'family-notes.txt'),'utf8'),'keep');assert.deepEqual(readFileSync(sourcePath),before);
  const manifest=readFileSync(join(dir,'STARTER_BANK_SHA256SUMS'),'utf8').trim().split('\n'),seen=new Set();assert.equal(manifest.length,4);for(const row of manifest){const [digest,name]=row.split('  ');assert(names.includes(name));assert(!seen.has(name));seen.add(name);assert.equal(hash(readFileSync(join(dir,name))),digest);}assert.deepEqual([...seen].sort(),names.filter(n=>n!=='STARTER_BANK_SHA256SUMS'));
  const shared=JSON.parse(readFileSync(join(dir,'beaa-starter-bank.shared.json'))),browser=JSON.parse(readFileSync(join(dir,'beaa-starter-bank.browser.json'))),report=JSON.parse(readFileSync(join(dir,'beaa-starter-bank.coverage.json')));assert.equal(shared.questions.length,90);assert.equal(browser.length,90);assert.equal(report.groups.length,18);assert.equal(report.educatorReview,'pending');assert.equal(report.curriculumAlignmentVerified,false);assert.equal(report.sharedSha256,hash(readFileSync(join(dir,'beaa-starter-bank.shared.json'))));assert.equal(report.sourceSha256,hash(before));
  for(let i=0;i<90;i++){const q=shared.questions[i],b=browser[i];assert.equal(b.id,q.id);assert.equal(b.text,q.stem);assert.equal(b.options[b.answer],q.options.find(o=>o.id===q.correctOptionId).text);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('invalid or incomplete source fails before creating or changing any delivered artifact',()=>{
 const dir=mkdtempSync(join(tmpdir(),'beaa-starter-invalid-'));try{
  const output=join(dir,'output'),source=join(dir,'input.json'),valid=JSON.parse(readFileSync(sourcePath));
  const incomplete=structuredClone(valid);incomplete.questions.shift();writeFileSync(source,JSON.stringify(incomplete));assert.throws(()=>buildStarterBank({sourcePath:source,outputDirectory:output}));assert.equal(existsSync(output),false);
  buildStarterBank({sourcePath,outputDirectory:output});const before=Object.fromEntries(readdirSync(output).map(n=>[n,readFileSync(join(output,n))]));
  const tooLong=structuredClone(valid);tooLong.questions[0].stem='字'.repeat(1001);
  const oversized=structuredClone(valid);oversized.questions.push(...Array.from({length:500},(_,i)=>({...structuredClone(valid.questions[0]),id:'huge-'+i,stem:'题'.repeat(1000),explanation:'解'.repeat(2000),options:['A','B','C','D'].map(id=>({id,text:'字'.repeat(499)+id})),correctOptionId:'A'})));
  for(const content of ['{broken',JSON.stringify(incomplete),JSON.stringify(tooLong),JSON.stringify(oversized)]){writeFileSync(source,content);assert.throws(()=>buildStarterBank({sourcePath:source,outputDirectory:output}));for(const [name,bytes] of Object.entries(before))assert.deepEqual(readFileSync(join(output,name)),bytes);}
  for(const args of [['--unknown'],['__proto__','ignored'],['constructor','ignored'],['toString','ignored']])assert.throws(()=>execFileSync(process.execPath,['scripts/package-starter-bank.mjs',...args],{cwd:new URL('../',import.meta.url),stdio:'pipe'}),e=>e.status===1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
