"""Test-only interrupted transaction. No production hooks, no credential output."""
import hashlib
import os
import sqlite3
import sys

path, kind = sys.argv[1:]
assert kind in ('guardian', 'auth', 'bank', 'reminder')
connection = sqlite3.connect(path, isolation_level=None)
connection.execute('PRAGMA cache_size=1')
connection.execute('BEGIN IMMEDIATE')
if kind == 'auth':
    salt = bytes(range(16))
    digest = hashlib.pbkdf2_hmac('sha256', b'739152', salt, 600000)
    connection.execute('UPDATE parent_auth SET credential_version=credential_version+1,salt=?,digest=?,failures=0,blocked_until_ms=0', (salt, digest))
    # Force cache spill before the abrupt exit, as can occur during a commit.
    connection.execute('CREATE TABLE uncommitted_spill(data BLOB)')
    connection.execute('INSERT INTO uncommitted_spill VALUES (?)', (b'x' * 262144,))
else:
    table = {'guardian': 'guardian_state', 'bank': 'question_bank', 'reminder': 'reminder_outbox'}[kind]
    connection.execute(f'UPDATE {table} SET payload=?,sha256=? WHERE id=1', ('x' * 262144, '0' * 64))
os._exit(0)
