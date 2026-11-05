"""Test-only external transaction writer; never imported by the production worker."""
import hashlib
import json
import signal
import sqlite3
import sys

path, mode = sys.argv[1:]
text = sys.stdin.read()
connection = sqlite3.connect(path, timeout=2, isolation_level=None)
connection.execute('PRAGMA synchronous=FULL')
connection.execute('BEGIN IMMEDIATE')
if mode != 'hold':
    state = json.loads(text)
    connection.execute('UPDATE guardian_state SET lifecycle_id=?, revision=?, payload=?, sha256=? WHERE id=1',
                       (state['lifecycleId'], state['revision'], text, hashlib.sha256(text.encode('utf-8')).hexdigest()))
if mode == 'after_commit':
    connection.execute('COMMIT')
print('ready', flush=True)
signal.pause()  # Parent test sends SIGKILL at this known transaction boundary.
