"""Build a reproducible standalone browser demo; no deployment or native compilation."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parent.parent
out = root / 'dist' / 'beaa-web-demo'
out.mkdir(parents=True, exist_ok=True)
files = {
    'index.html': (root / 'apps/web-preview/index.html').read_bytes(),
    'README.md': (root / 'apps/web-preview/README.md').read_bytes(),
    'mixed-bank.json': (root / 'shared/quiz/mixed-browser-questions.json').read_bytes(),
    'sample-bank.json': (json.dumps([{
        'id': 'math-g3-add-001', 'grade': 3, 'subject': 'math',
        'topic': 'arithmetic', 'text': '15 + 17 = ?', 'options': ['31', '32', '33'],
        'answer': 1, 'explain': '15+17=32。'
    }], ensure_ascii=False, indent=2) + '\n').encode(),
}
files['SHA256SUMS'] = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n' for name, data in sorted(files.items())).encode()
for name, data in files.items():
    (out / name).write_bytes(data)
archive = root / 'dist/beaa-web-demo.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as package:
    for name, data in sorted(files.items()):
        entry = zipfile.ZipInfo(f'beaa-web-demo/{name}', (2026, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(entry, data)
print(f'Packaged standalone demo: {archive}')
