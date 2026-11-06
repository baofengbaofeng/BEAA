"""Private SQLite protocol worker for the POSIX/Node reference adapter, not a native backend."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys

APPLICATION_ID = 0x42454141
SCHEMA_VERSION = 1
MAX_REVISION = 9007199254740991
MAX_TEXT_UNITS = 8000000
MAX_REQUEST_BYTES = 32 * 1024 * 1024


class StoreFailure(Exception):
    def __init__(self, code):
        self.code = code


def check(condition, code):
    if not condition:
        raise StoreFailure(code)


def fields(value, keys):
    check(type(value) is dict and set(value) == set(keys), 'INVALID_REQUEST')


def revision(value):
    return type(value) is int and 0 <= value <= MAX_REVISION


def metadata(text):
    check(type(text) is str and len(text.encode('utf-16-le')) // 2 <= MAX_TEXT_UNITS, 'CORRUPT_STORE')
    value = json.loads(text)
    check(type(value) is dict and type(value.get('schemaVersion')) is int and value.get('schemaVersion') in (1, 2) and
          type(value.get('lifecycleId')) is str and revision(value.get('revision')), 'CORRUPT_STORE')
    identity = value['lifecycleId']
    check(0 < len(identity) <= 96 and identity.strip() == identity, 'CORRUPT_STORE')
    identity.encode('utf-8')
    return identity, value['revision']


def secure_path(path, existing=True):
    # SQLite reopens by pathname (including its journal); every ancestor must resist
    # replacement by a different UID. Sticky shared directories protect owned entries.
    # The root mount owner may be UID-mapped in a managed container (not numeric 0).
    trusted_owners = {0, os.geteuid(), Path(path.anchor).lstat().st_uid}
    for ancestor in reversed(path.parents):
        entry = ancestor.lstat()
        check(stat.S_ISDIR(entry.st_mode) and entry.st_uid in trusted_owners, 'UNSAFE_STORAGE')
        if entry.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            check(entry.st_mode & stat.S_ISVTX, 'UNSAFE_STORAGE')
    parent = path.parent.lstat()
    check(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.geteuid() and parent.st_mode & 0o077 == 0, 'UNSAFE_STORAGE')
    if not existing:
        return
    try:
        entry = path.lstat()
    except FileNotFoundError:
        raise StoreFailure('STORE_MISSING')
    check(stat.S_ISREG(entry.st_mode) and entry.st_uid == os.geteuid() and
          entry.st_nlink == 1 and entry.st_mode & 0o077 == 0, 'UNSAFE_STORAGE')


def validate_header(path, application_id, schema_version=1,
                    corrupt_code='CORRUPT_STORE', unsupported_code='UNSUPPORTED_STORE'):
    # Format preflight before SQLite can change files during hot-journal recovery.
    # Markers remain fixed in supported writers; this is not authentication.
    secure_path(path)
    with path.open('rb') as source:
        header = source.read(100)
    check(len(header) == 100 and header[:16] == b'SQLite format 3\x00', corrupt_code)
    check(int.from_bytes(header[68:72], 'big') == application_id and
          int.from_bytes(header[60:64], 'big') == schema_version and
          header[18] == 1 and header[19] == 1, unsupported_code)


def connect_existing(path, read_only=False):
    secure_path(path)
    connection = sqlite3.connect(path.as_uri() + ('?mode=ro' if read_only else '?mode=rw'), uri=True, timeout=2, isolation_level=None)
    connection.execute('PRAGMA synchronous=FULL')
    return connection


def validate_format(connection):
    check(connection.execute('PRAGMA application_id').fetchone()[0] == APPLICATION_ID and
          connection.execute('PRAGMA user_version').fetchone()[0] == SCHEMA_VERSION, 'UNSUPPORTED_STORE')
    check(connection.execute('PRAGMA journal_mode').fetchone()[0].lower() == 'delete', 'UNSUPPORTED_STORE')
    columns = [row[1] for row in connection.execute('PRAGMA table_info(guardian_state)')]
    check(columns == ['id', 'lifecycle_id', 'revision', 'payload', 'sha256'], 'UNSUPPORTED_STORE')


def read_row(connection):
    validate_format(connection)
    rows = connection.execute('SELECT id,lifecycle_id,revision,payload,sha256 FROM guardian_state').fetchall()
    check(len(rows) == 1 and rows[0][0] == 1, 'CORRUPT_STORE')
    _, identity, rev, text, digest = rows[0]
    check(type(text) is str and type(digest) is str and
          hmac.compare_digest(hashlib.sha256(text.encode('utf-8')).hexdigest(), digest), 'CORRUPT_STORE')
    check(metadata(text) == (identity, rev), 'CORRUPT_STORE')
    return identity, rev, text


def reserve_private_file(path):
    secure_path(path, existing=False)
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
    except FileExistsError:
        raise StoreFailure('ALREADY_EXISTS')
    os.close(descriptor)


def initialize(path, text):
    identity, rev = metadata(text)
    check(rev == 0, 'INVALID_REQUEST')
    reserve_private_file(path)
    connection = connect_existing(path)
    try:
        connection.execute('PRAGMA journal_mode=DELETE')
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('CREATE TABLE guardian_state ('
                           'id INTEGER PRIMARY KEY CHECK(id=1), lifecycle_id TEXT NOT NULL, '
                           'revision INTEGER NOT NULL CHECK(revision>=0 AND revision<=9007199254740991), '
                           'payload TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64))')
        connection.execute(f'PRAGMA application_id={APPLICATION_ID}')
        connection.execute(f'PRAGMA user_version={SCHEMA_VERSION}')
        connection.execute('INSERT INTO guardian_state VALUES (1,?,?,?,?)',
                           (identity, rev, text, hashlib.sha256(text.encode('utf-8')).hexdigest()))
        connection.execute('COMMIT')
    finally:
        connection.close()
    return True



def backup_database(path, target):
    # Pin the source read snapshot before reserving any destination. Copy the database
    # with SQLite, never by copying a live database/journal file pair.
    validate_header(path, APPLICATION_ID, SCHEMA_VERSION)
    source = connect_existing(path, read_only=True)
    try:
        source.execute('BEGIN')
        expected = read_row(source)
        reserve_private_file(target)
        destination = connect_existing(target)
        try:
            source.backup(destination, pages=128, sleep=0.05)
            copied = read_row(destination)
            check(copied == expected, 'CORRUPT_STORE')
        finally:
            destination.close()
        source.execute('COMMIT')
        return copied[2]
    finally:
        source.close()


def run(path, message):
    check(type(message) is dict, 'INVALID_REQUEST')
    operation = message.get('operation')
    if operation == 'initialize':
        fields(message, ['operation', 'text'])
        return initialize(path, message['text'])
    if operation == 'backup':
        fields(message, ['operation', 'target'])
        check(type(message['target']) is str and len(message['target']) > 0, 'INVALID_REQUEST')
        return backup_database(path, Path(message['target']).absolute())
    check(operation in ('read', 'inspect', 'cas'), 'INVALID_REQUEST')
    fields(message, ['operation'] if operation in ('read', 'inspect') else ['operation', 'expected', 'text'])
    if operation == 'cas':
        expected = message['expected']
        fields(expected, ['lifecycleId', 'revision'])
        check(type(expected['lifecycleId']) is str and revision(expected['revision']), 'INVALID_REQUEST')
        identity, rev = metadata(message['text'])
        check(identity == expected['lifecycleId'] and rev == expected['revision'] + 1, 'INVALID_REQUEST')
    validate_header(path, APPLICATION_ID, SCHEMA_VERSION)
    connection = connect_existing(path, read_only=operation == 'inspect')
    try:
        connection.execute('BEGIN' if operation in ('read', 'inspect') else 'BEGIN IMMEDIATE')
        current_id, current_rev, current_text = read_row(connection)
        if operation in ('read', 'inspect'):
            connection.execute('COMMIT')
            return current_text
        if (current_id, current_rev) != (expected['lifecycleId'], expected['revision']):
            connection.execute('ROLLBACK')
            return False
        connection.execute('UPDATE guardian_state SET lifecycle_id=?,revision=?,payload=?,sha256=? WHERE id=1',
                           (identity, rev, message['text'], hashlib.sha256(message['text'].encode('utf-8')).hexdigest()))
        connection.execute('COMMIT')
        return True
    finally:
        connection.close()


def main():
    try:
        check(os.name == 'posix' and sys.version_info >= (3, 11) and len(sys.argv) == 2, 'UNSUPPORTED_PLATFORM')
        data = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        check(len(data) <= MAX_REQUEST_BYTES, 'INVALID_REQUEST')
        value = run(Path(sys.argv[1]).absolute(), json.loads(data.decode('utf-8')))
        response = {'ok': True, 'value': value}
    except StoreFailure as error:
        response = {'ok': False, 'code': error.code}
    except sqlite3.OperationalError as error:
        code = getattr(error, 'sqlite_errorcode', None)
        response = {'ok': False, 'code': 'STORE_BUSY' if type(code) is int and (code & 0xff) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED) else 'STORE_IO'}
    except sqlite3.DatabaseError:
        response = {'ok': False, 'code': 'CORRUPT_STORE'}
    except (ValueError, TypeError, UnicodeError):
        response = {'ok': False, 'code': 'CORRUPT_STORE'}
    except OSError:
        response = {'ok': False, 'code': 'STORE_IO'}
    sys.stdout.write(json.dumps(response, ensure_ascii=False))
    return 0 if response['ok'] else 1


if __name__ == '__main__':
    sys.exit(main())
