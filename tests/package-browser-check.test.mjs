import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
test('offline checker embeds exact MVP bytes with reproducible integrity metadata',async()=>{
 const out=mkdtempSync(join(tmpdir(),'beaa-check-'));
 try{
  const build=()=>execFileSync('python3',['scripts/package-browser-check.py','--output-dir',out],{cwd:new URL('../',import.meta.url)});
  build();const first=readFileSync(join(out,'beaa-browser-check.html'),'utf8');await delay(2100);build();assert.equal(readFileSync(join(out,'beaa-browser-check.html'),'utf8'),first);
  const payload=JSON.parse(first.match(/<script type="application\/json" id="beaa-app-source">(.*?)<\/script>/s)[1]);
  const actual=readFileSync(new URL('../apps/web-preview/index.html',import.meta.url));assert.deepEqual(Buffer.from(payload.base64,'base64'),actual);assert.equal(payload.sha256,createHash('sha256').update(actual).digest('hex'));assert.equal(payload.format,1);
 }finally{rmSync(out,{recursive:true,force:true});}
});
