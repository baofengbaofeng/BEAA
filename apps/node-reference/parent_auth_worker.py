"""Linux-only local PIN reference; never an OS account or native secure-store substitute."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time
from sqlite_worker import StoreFailure, check, fields, reserve_private_file, connect_existing, revision

APPLICATION_ID = 0x42454150
ITERATIONS = 600000
COOLDOWN_MS = 300000
MAX_REVISION = 9007199254740991
COLUMNS = ['id', 'lifecycle_id', 'credential_version', 'salt', 'digest', 'failures', 'boot_id', 'last_seen_ms', 'blocked_until_ms']


def valid_pin(pin):
    check(type(pin) is str and re.fullmatch(r'[0-9]{6,12}', pin), 'INVALID_PIN')


def current_clock():
    try:
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        check(0 < len(boot) <= 128, 'PARENT_CLOCK_ERROR')
        now = time.monotonic_ns() // 1000000
        check(revision(now), 'PARENT_CLOCK_ERROR')
        return boot, now
    except OSError:
        raise StoreFailure('PARENT_CLOCK_ERROR')


def identity(row):
    return {'lifecycleId': row[1], 'credentialVersion': row[2]}


def read_row(connection):
    check(connection.execute('PRAGMA application_id').fetchone()[0] == APPLICATION_ID and
          connection.execute('PRAGMA user_version').fetchone()[0] == 1, 'UNSUPPORTED_AUTH_STORE')
    check([r[1] for r in connection.execute('PRAGMA table_info(parent_auth)')] == COLUMNS, 'CORRUPT_AUTH_STORE')
    rows = connection.execute('SELECT * FROM parent_auth').fetchall()
    check(len(rows) == 1, 'CORRUPT_AUTH_STORE')
    row = rows[0]
    check(row[0] == 1 and type(row[1]) is str and 0 < len(row[1]) <= 96 and row[1].strip() == row[1] and
          type(row[2]) is int and 1 <= row[2] <= MAX_REVISION and type(row[3]) is bytes and len(row[3]) == 16 and
          type(row[4]) is bytes and len(row[4]) == 32 and type(row[5]) is int and 0 <= row[5] <= 5 and
          type(row[6]) is str and 0 < len(row[6]) <= 128 and revision(row[7]) and revision(row[8]), 'CORRUPT_AUTH_STORE')
    check((row[5] == 5 and row[8] > row[7]) or (row[5] < 5 and row[8] == 0), 'CORRUPT_AUTH_STORE')
    return row


def initialize(path, message):
    fields(message, ['operation', 'lifecycleId', 'pin'])
    scope = message['lifecycleId']; valid_pin(message['pin'])
    check(type(scope) is str and 0 < len(scope) <= 96 and scope.strip() == scope, 'INVALID_REQUEST')
    boot, now = current_clock(); reserve_private_file(path)
    connection = connect_existing(path)
    try:
        salt = secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac('sha256', message['pin'].encode('ascii'), salt, ITERATIONS)
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('CREATE TABLE parent_auth (id INTEGER PRIMARY KEY CHECK(id=1), lifecycle_id TEXT NOT NULL, '
                           'credential_version INTEGER NOT NULL, salt BLOB NOT NULL, digest BLOB NOT NULL, '
                           'failures INTEGER NOT NULL, boot_id TEXT NOT NULL, last_seen_ms INTEGER NOT NULL, blocked_until_ms INTEGER NOT NULL)')
        connection.execute(f'PRAGMA application_id={APPLICATION_ID}'); connection.execute('PRAGMA user_version=1')
        connection.execute('INSERT INTO parent_auth VALUES (1,?,1,?,?,0,?,?,0)', (scope, salt, digest, boot, now))
        connection.execute('COMMIT')
        return {'lifecycleId': scope, 'credentialVersion': 1}
    finally:
        connection.close()


def login(connection, row, pin):
    valid_pin(pin); boot, now = current_clock()
    failures, blocked = row[5], row[8]
    if (boot == row[6] and now < row[7]) or (boot != row[6] and failures == 5):
        failures, blocked = 5, now + COOLDOWN_MS
    elif failures == 5 and now >= blocked:
        failures, blocked = 0, 0
    if failures == 5:
        result = {'status': 'locked'}
        # last_seen must not exceed a still-active blocked boundary.
    else:
        calculated = hashlib.pbkdf2_hmac('sha256', pin.encode('ascii'), row[3], ITERATIONS)
        if hmac.compare_digest(calculated, row[4]):
            failures, blocked = 0, 0; result = {'status': 'accepted', 'identity': identity(row)}
        else:
            failures += 1; blocked = now + COOLDOWN_MS if failures == 5 else 0
            result = {'status': 'invalid'}
    connection.execute('UPDATE parent_auth SET failures=?,boot_id=?,last_seen_ms=?,blocked_until_ms=? WHERE id=1',
                       (failures, boot, now, blocked))
    return result


def run(path, message):
    check(type(message) is dict, 'INVALID_REQUEST'); operation = message.get('operation')
    if operation == 'initialize':
        return initialize(path, message)
    check(operation in ('status', 'login', 'change_pin'), 'INVALID_REQUEST')
    fields(message, ['operation'] if operation == 'status' else ['operation', 'pin'] if operation == 'login' else ['operation', 'expectedVersion', 'pin'])
    connection = connect_existing(path, read_only=operation == 'status')
    try:
        connection.execute('BEGIN' if operation == 'status' else 'BEGIN IMMEDIATE'); row = read_row(connection)
        if operation == 'status':
            result = identity(row)
        elif operation == 'login':
            result = login(connection, row, message['pin'])
        else:
            valid_pin(message['pin']); check(message['expectedVersion'] == row[2], 'PARENT_REVOKED')
            check(row[2] < MAX_REVISION, 'PARENT_VERSION_EXHAUSTED'); boot, now = current_clock()
            salt = secrets.token_bytes(16); digest = hashlib.pbkdf2_hmac('sha256', message['pin'].encode('ascii'), salt, ITERATIONS)
            connection.execute('UPDATE parent_auth SET credential_version=?,salt=?,digest=?,failures=0,boot_id=?,last_seen_ms=?,blocked_until_ms=0 WHERE id=1',
                               (row[2] + 1, salt, digest, boot, now))
            result = {'lifecycleId': row[1], 'credentialVersion': row[2] + 1}
        connection.execute('COMMIT'); return result
    finally:
        connection.close()


def main():
    try:
        check(sys.platform == 'linux' and sys.version_info >= (3, 11) and len(sys.argv) == 2, 'UNSUPPORTED_PLATFORM')
        data = sys.stdin.buffer.read(16385); check(len(data) <= 16384, 'INVALID_REQUEST')
        result = run(Path(sys.argv[1]).absolute(), json.loads(data.decode('utf-8')))
        response = {'ok': True, 'value': result}
    except StoreFailure as error:
        response = {'ok': False, 'code': error.code}
    except sqlite3.OperationalError as error:
        code = getattr(error, 'sqlite_errorcode', None)
        response = {'ok': False, 'code': 'STORE_BUSY' if type(code) is int and (code & 0xff) in (5, 6) else 'STORE_IO'}
    except sqlite3.DatabaseError:
        response = {'ok': False, 'code': 'CORRUPT_AUTH_STORE'}
    except (ValueError, TypeError, UnicodeError):
        response = {'ok': False, 'code': 'CORRUPT_AUTH_STORE'}
    except OSError:
        response = {'ok': False, 'code': 'STORE_IO'}
    sys.stdout.write(json.dumps(response, ensure_ascii=False)); return 0 if response['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
