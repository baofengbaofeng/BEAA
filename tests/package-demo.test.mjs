import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Exercise the delivered artifact, including a consumer checking its manifest.
test('standalone package contains matching sources, valid quiz data and reproducible checksums', async () => {
  const root = new URL('../', import.meta.url);
  execFileSync('python3', ['scripts/package-demo.py'], { cwd: root });
  const first = readFileSync(new URL('dist/beaa-web-demo.zip', root));
  // ZIP timestamps have two-second precision; cross that boundary deliberately.
  await delay(2100);
  execFileSync('python3', ['scripts/package-demo.py'], { cwd: root });
  assert.deepEqual(readFileSync(new URL('dist/beaa-web-demo.zip', root)), first);
  const result = execFileSync('python3', ['-c', `
from pathlib import Path
from zipfile import ZipFile
import hashlib,json
with ZipFile('dist/beaa-web-demo.zip') as package:
    expected={'index.html','README.md','sample-bank.json','SHA256SUMS'}
    names={name.removeprefix('beaa-web-demo/') for name in package.namelist()}
    assert names == expected
    manifest=package.read('beaa-web-demo/SHA256SUMS').decode().splitlines()
    assert len(manifest) == 3
    seen=set()
    for line in manifest:
        digest,name=line.split('  ')
        assert name in expected - {'SHA256SUMS'}
        assert name not in seen
        seen.add(name)
        assert hashlib.sha256(package.read('beaa-web-demo/'+name)).hexdigest() == digest
    assert seen == expected - {'SHA256SUMS'}
    for name in ['index.html','README.md']:
        assert package.read('beaa-web-demo/'+name) == Path('apps/web-preview',name).read_bytes()
    bank=json.loads(package.read('beaa-web-demo/sample-bank.json'))
    assert len(bank) > 0
    for q in bank:
        assert 0 <= q['answer'] < len(q['options'])
        assert q['explain']
print('artifact consumer validation passed')
`], { cwd: root, encoding: 'utf8' });
  assert.match(result, /artifact consumer validation passed/);
});
