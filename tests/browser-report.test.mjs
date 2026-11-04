import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeBrowserResults } from '../scripts/report-browser-results.mjs';

test('browser report includes nested failure details and preserves skipped counts',()=>{
 const report={stats:{expected:2,unexpected:1,skipped:1,flaky:0},suites:[{title:'outer',suites:[{title:'flows',specs:[{title:'PIN flow',file:'tests/browser/mvp.spec.mjs',line:5,tests:[{status:'unexpected',results:[{status:'failed',errors:[{message:'Expected success\nReceived failure'}]}]}]}]}]}]};
 const result=summarizeBrowserResults(report);
 assert.match(result.markdown,/2 passed.*1 failed.*1 skipped/);
 assert.match(result.markdown,/PIN flow/);
 assert.match(result.markdown,/Received failure/);
 assert.match(result.annotations[0],/file=tests\/browser\/mvp.spec.mjs,line=5/);
 assert.match(result.annotations[0],/Expected success%0AReceived failure/);
});

test('browser report rejects missing outcome statistics',()=>{
 assert.throws(()=>summarizeBrowserResults({suites:[]}),/statistics/);
});

test('report CLI fails CI on skipped or empty browser runs', async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const directory=mkdtempSync(join(tmpdir(),'beaa-report-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 mkdirSync(join(directory,'test-results'));
 for(const stats of [{expected:11,unexpected:0,skipped:1,flaky:0},{expected:0,unexpected:0,skipped:0,flaky:0}]){
  writeFileSync(join(directory,'test-results/browser-results.json'),JSON.stringify({stats,suites:[]}));
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/report-browser-results.mjs',import.meta.url))],{cwd:directory,encoding:'utf8',env:{CI:'true'}});
  assert.equal(result.status,1);assert.match(result.stdout,/Browser acceptance/);
 }
});

test('report CLI never emits failure text as executable workflow commands',async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
 const directory=mkdtempSync(join(tmpdir(),'beaa-report-injection-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 mkdirSync(join(directory,'test-results'));
 const message='failure\n::stop-commands::test-token\n::error::forged';
 writeFileSync(join(directory,'test-results/browser-results.json'),JSON.stringify({stats:{expected:1,unexpected:1,skipped:0,flaky:0},suites:[{specs:[{title:'untrusted failure',tests:[{status:'unexpected',results:[{errors:[{message}]}]}]}]}]}));
 const summary=join(directory,'summary.md');
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/report-browser-results.mjs',import.meta.url))],{cwd:directory,encoding:'utf8',env:{CI:'true',GITHUB_STEP_SUMMARY:summary}});
 assert.equal(result.status,1);
 assert.doesNotMatch(result.stdout,/(?:^|\n)::stop-commands::/);
 assert.match(result.stdout,/%0A::stop-commands::test-token%0A/);
 assert.ok(readFileSync(summary,'utf8').includes(message));
});
