import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const escapeCommand = text => String(text).replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
const plain = text => String(text).replace(/\u001b\[[0-9;]*m/g,'');

export function summarizeBrowserResults(report) {
  const stats = report?.stats;
  if (!stats || !['expected','unexpected','skipped','flaky'].every(k=>Number.isInteger(stats[k]) && stats[k]>=0)) {
    throw Error('Browser outcome statistics are missing or invalid');
  }
  const failures = [];
  function visit(suites) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          if (test.status === 'unexpected' || test.status === 'flaky') {
            const errors = (test.results || []).flatMap(result=>result.errors || []);
            failures.push({ title:spec.title, file:spec.file, line:spec.line,
              message:plain(errors.map(e=>e.message || e.value || 'Unknown error').join('\n') || 'Unexpected browser test result').slice(0,6000) });
          }
        }
      }
      visit(suite.suites);
    }
  }
  visit(report.suites);
  for (const error of report.errors || []) failures.push({title:'Browser runner',message:plain(error.message || error.value || 'Runner error')});
  const counts = `${stats.expected} passed, ${stats.unexpected} failed, ${stats.skipped} skipped, ${stats.flaky} flaky`;
  const annotations = failures.map(f=>{
    const rawFile=f.file?.startsWith('tests/')?f.file:`tests/browser/${f.file || ''}`;
    const location=f.file && /^[\w./-]+$/.test(rawFile)?`file=${rawFile},line=${Number.isInteger(f.line)?f.line:1},`:'';
    return `::error ${location}title=Browser test failure::${escapeCommand(f.title+'\n'+f.message)}`;
  });
  return {
    markdown:`## Browser acceptance\n\n${counts}\n\n`+failures.map(f=>`### ${f.title}\n\n\`\`\`text\n${f.message}\n\`\`\`\n`).join('\n'),
    annotations, stats, failures
  };
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const summary=summarizeBrowserResults(JSON.parse(readFileSync('test-results/browser-results.json','utf8')));
    console.log(summary.markdown);
    for(const annotation of summary.annotations) console.log(annotation);
    if(process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary.markdown);
    if(summary.stats.unexpected || summary.stats.flaky || summary.failures.length || !summary.stats.expected || process.env.CI && summary.stats.skipped) process.exitCode=1;
  } catch(error) {
    console.log(`::error title=Browser report unavailable::${escapeCommand(error.message)}`);
    process.exitCode=1;
  }
}
