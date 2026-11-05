"""Reproducible offline verifier embedding the unchanged browser MVP."""
from pathlib import Path
import argparse
import base64
import hashlib
import json

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-dir', type=Path, default=root / 'dist')
args = parser.parse_args()
source = (root / 'apps/web-preview/index.html').read_bytes()
payload = json.dumps({'format': 1, 'base64': base64.b64encode(source).decode(),
                      'sha256': hashlib.sha256(source).hexdigest()})
template = (root / 'apps/browser-check/index.html').read_text()
marker = '{"format":1,"base64":null,"sha256":null}'
if template.count(marker) != 1:
    raise ValueError('Expected exactly one source placeholder')
args.output_dir.mkdir(parents=True, exist_ok=True)
output = args.output_dir / 'beaa-browser-check.html'
output.write_text(template.replace(marker, payload), encoding='utf-8')
print(f'Packaged offline browser check: {output}')
