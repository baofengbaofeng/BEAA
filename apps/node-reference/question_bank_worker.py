"""Private reference question-bank catalog; never a native store or public protocol."""
import hashlib
import hmac
import json
from pathlib import Path
import os
import sqlite3
import sys
from sqlite_worker import StoreFailure, check, fields, revision, reserve_private_file, connect_existing, secure_path

APPLICATION_ID = 0x42454151
COLUMNS = ['id', 'lifecycle_id', 'revision', 'payload', 'sha256']
MAX_REQUEST_BYTES = 16 * 1024 * 1024


def metadata(text):
    check(type(text) is str and len(text.encode('utf-16-le')) // 2 <= 2000000, 'CORRUPT_STORE')
    value = json.loads(text)
    check(type(value) is dict and type(value.get('schemaVersion')) is int and value['schemaVersion'] == 1 and
          type(value.get('lifecycleId')) is str and revision(value.get('revision')), 'CORRUPT_STORE')
    identity = value['lifecycleId']
    check(0 < len(identity) <= 96 and identity.strip() == identity, 'CORRUPT_STORE')
    identity.encode('utf-8')
    return identity, value['revision']


def read_row(connection):
    check(connection.execute('PRAGMA application_id').fetchone()[0] == APPLICATION_ID and
          connection.execute('PRAGMA user_version').fetchone()[0] == 1 and
          connection.execute('PRAGMA journal_mode').fetchone()[0].lower() == 'delete' and
          [r[1] for r in connection.execute('PRAGMA table_info(question_bank)')] == COLUMNS, 'UNSUPPORTED_STORE')
    rows = connection.execute('SELECT id,lifecycle_id,revision,payload,sha256 FROM question_bank').fetchall()
    check(len(rows) == 1 and rows[0][0] == 1, 'CORRUPT_STORE')
    _, identity, rev, text, digest = rows[0]
    check(type(identity) is str and revision(rev) and type(text) is str and type(digest) is str and
          hmac.compare_digest(hashlib.sha256(text.encode('utf-8')).hexdigest(), digest), 'CORRUPT_STORE')
    check(metadata(text) == (identity, rev), 'CORRUPT_STORE')
    return identity, rev, text


def initialize(path, text):
    identity, rev = metadata(text)
    check(rev == 0, 'INVALID_REQUEST')
    reserve_private_file(path)
    connection = connect_existing(path)
    try:
        connection.execute('PRAGMA journal_mode=DELETE')
        connection.execute('BEGIN IMMEDIATE')
        connection.execute('CREATE TABLE question_bank ('
                           'id INTEGER PRIMARY KEY CHECK(id=1), lifecycle_id TEXT NOT NULL, '
                           'revision INTEGER NOT NULL, payload TEXT NOT NULL, sha256 TEXT NOT NULL)')
        connection.execute(f'PRAGMA application_id={APPLICATION_ID}')
        connection.execute('PRAGMA user_version=1')
        connection.execute('INSERT INTO question_bank VALUES (1,?,?,?,?)',
                           (identity, rev, text, hashlib.sha256(text.encode('utf-8')).hexdigest()))
        connection.execute('COMMIT')
    finally:
        connection.close()
    return True


def validate_header(path):
    # Identify the private catalog before SQLite may recover a hot journal.
    # This is only a format preflight; read_row validates the recovered database.
    secure_path(path)
    with path.open('rb') as source:
        header = source.read(100)
    check(len(header) == 100 and header[:16] == b'SQLite format 3\x00', 'CORRUPT_STORE')
    check(int.from_bytes(header[68:72], 'big') == APPLICATION_ID and
          int.from_bytes(header[60:64], 'big') == 1 and
          header[18] == 1 and header[19] == 1, 'UNSUPPORTED_STORE')


def run(path, message):
    check(type(message) is dict, 'INVALID_REQUEST')
    operation = message.get('operation')
    if operation == 'initialize':
        fields(message, ['operation', 'text'])
        return initialize(path, message['text'])
    check(operation in ('read', 'cas'), 'INVALID_REQUEST')
    fields(message, ['operation'] if operation == 'read' else ['operation', 'expected', 'text'])
    if operation == 'cas':
        expected = message['expected']
        fields(expected, ['lifecycleId', 'revision'])
        check(type(expected['lifecycleId']) is str and revision(expected['revision']), 'INVALID_REQUEST')
        identity, rev = metadata(message['text'])
        check(identity == expected['lifecycleId'] and rev == expected['revision'] + 1, 'INVALID_REQUEST')
    validate_header(path)
    # Even a logical read must permit SQLite to roll back a valid interrupted import.
    connection = connect_existing(path)
    try:
        connection.execute('BEGIN' if operation == 'read' else 'BEGIN IMMEDIATE')
        current_id, current_rev, current_text = read_row(connection)
        if operation == 'read':
            connection.execute('COMMIT')
            return current_text
        if (current_id, current_rev) != (expected['lifecycleId'], expected['revision']):
            connection.execute('ROLLBACK')
            return False
        connection.execute('UPDATE question_bank SET revision=?,payload=?,sha256=? WHERE id=1',
                           (rev, message['text'], hashlib.sha256(message['text'].encode('utf-8')).hexdigest()))
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
        response = {'ok': False, 'code': 'STORE_BUSY' if type(code) is int and (code & 0xff) in (5, 6) else 'STORE_IO'}
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
