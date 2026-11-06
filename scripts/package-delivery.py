"""Reproducible local delivery from tracked working bytes. Does not execute tests or publish."""
from pathlib import Path
from tempfile import TemporaryDirectory, NamedTemporaryFile
import argparse
import hashlib
import io
import os
import json
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PREFIXES = ('apps/', 'shared/', 'tests/', 'docs/', 'scripts/', '.github/')
ROOT_FILES = {'README.md', 'package.json', 'package-lock.json', 'playwright.config.mjs', '.gitignore'}
PRIVATE_SUFFIXES = {'.db', '.sqlite', '.sqlite3', '.pem', '.p12', '.pfx', '.key', '.jks', '.keystore', '.pyc'}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def archive(files, prefix):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as package:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(prefix + name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(info, data)
    return buffer.getvalue()

def sources():
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
    result = {}
    for name in filter(None, names):
        if name not in ROOT_FILES and not name.startswith(PREFIXES):
            continue
        path = ROOT / name
        if path.suffix.lower() in PRIVATE_SUFFIXES or any(part in {'local-data', 'device-logs', '.env'} or part.startswith('.env.') for part in Path(name).parts):
            raise ValueError('Private runtime material must not be tracked in delivery sources')
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise ValueError('Source must be a regular file within the repository')
        result[name] = path.read_bytes()
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/beaa-delivery')
    out = parser.parse_args().output.absolute()
    package_path = Path(str(out) + '.zip')
    if out.is_symlink() or package_path.is_symlink():
        raise ValueError('Unsafe output symlink; choose a new path')
    if out.exists():
        try:
            previous = json.loads((out / 'manifest.json').read_text())
            actual = {p.relative_to(out).as_posix() for p in out.rglob('*') if p.is_file()}
            if out.is_symlink() or previous['generator'] != 'BEAA delivery' or actual != set(previous['outputFiles']) or any(p.is_symlink() for p in out.rglob('*')):
                raise ValueError()
        except (OSError, ValueError, KeyError, TypeError):
            raise ValueError('Unrelated output directory; choose a new path') from None
    elif package_path.exists():
        raise ValueError('Unrelated output archive; choose a new path')
    files = sources()
    required = ['scripts/package-native-preview.mjs', 'docs/DELIVERY_GUIDE.md', 'docs/testing/COMPLETE_DELIVERY_REPORT.md', 'apps/harmony/entry/src/main/resources/rawfile/beaa-preview.html']
    if any(name not in files for name in required):
        raise ValueError('Delivery sources missing; stage or commit all intended source files first')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=ROOT))
    contents = {}
    with TemporaryDirectory(prefix='beaa-delivery-build-') as temp:
        snapshot = Path(temp)
        for name, data in files.items():
            target = snapshot / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        for command in [
            ['node', 'scripts/package-native-preview.mjs', '--check'],
            [sys.executable, 'scripts/package-demo.py'],
            [sys.executable, 'scripts/package-browser-check.py'],
            ['node', 'scripts/package-starter-bank.mjs']
        ]:
            subprocess.run(command, cwd=snapshot, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for path in (snapshot / 'dist/beaa-web-demo').iterdir():
            contents['web/' + path.name] = path.read_bytes()
        for path in (snapshot / 'dist/beaa-starter-bank').iterdir():
            contents['question-bank/' + path.name] = path.read_bytes()
        for name in ['beaa-web-demo.zip', 'beaa-browser-check.html']:
            contents[name] = (snapshot / 'dist' / name).read_bytes()
    contents['beaa-source.zip'] = archive(files, 'BEAA/')
    for name, source in {'DELIVERY_GUIDE.md': 'docs/DELIVERY_GUIDE.md', 'DEVICE_POC.md': 'docs/DEVICE_POC.md', 'DEVICE_ACCEPTANCE_RECORD_TEMPLATE.md': 'docs/testing/DEVICE_ACCEPTANCE_RECORD_TEMPLATE.md'}.items():
        contents[name] = files[source]
    manifest = {
        'schemaVersion': 1, 'generator': 'BEAA delivery', 'sourceCommit': commit,
        'sourceContainsWorkingTreeChanges': dirty,
        'sourceTreeSha256': digest(json.dumps([(name, digest(data)) for name, data in sorted(files.items())], separators=(',', ':')).encode()),
        'nativeBuildValidated': False, 'deviceControlValidated': False, 'healthOutcomeValidated': False,
        'testsExecutedByPackager': False, 'testEvidence': 'BEAA/docs/testing/COMPLETE_DELIVERY_REPORT.md',
        'outputFiles': sorted([*contents, 'manifest.json', 'SHA256SUMS'])
    }
    contents['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    contents['SHA256SUMS'] = ''.join(digest(data) + '  ' + name + '\n' for name, data in sorted(contents.items())).encode()
    out.mkdir(parents=True, exist_ok=True)
    for name, data in contents.items():
        path = out / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    staged_archive = None
    try:
        with NamedTemporaryFile(dir=out.parent, prefix='.beaa-delivery-', delete=False) as staged:
            staged_archive = Path(staged.name)
            staged.write(archive(contents, 'BEAA-delivery/'))
        os.replace(staged_archive, package_path)
    finally:
        if staged_archive is not None:
            staged_archive.unlink(missing_ok=True)
    print('Local delivery prepared: ' + str(package_path) + '; tests and native build were not executed')

if __name__ == '__main__':
    main()
