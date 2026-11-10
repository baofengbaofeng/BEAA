import relationalStore from '@ohos.data.relationalStore';
import common from '@ohos.app.ability.common';
import { GuardianStorage, GuardianState, initialGuardian, validateGuardian } from './GuardianCore';
function createGuardianPayload(): string { return JSON.stringify(initialGuardian()); }
function validateGuardianPayload(text: string): GuardianState { return validateGuardian(JSON.parse(text) as GuardianState); }

const SCOPE = 'native-guardian';
const APP_ID = 0x42454147;
/** Candidate API10 encrypted credential + budget + learning provenance transaction store; never reset on corruption. */
export class NativeGuardianStore implements GuardianStorage {
  private tail: Promise<void> = Promise.resolve();
  private constructor(private db: relationalStore.RdbStore) {}

  static async open(context: common.UIAbilityContext): Promise<NativeGuardianStore> {
    const db = await relationalStore.getRdbStore(context, {
      name: 'beaa-native-guardian.db', securityLevel: relationalStore.SecurityLevel.S3, encrypt: true
    });
    const store = new NativeGuardianStore(db);
    await store.initialize();
    return store;
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work); this.tail = next.then(() => {}, () => {}); return next;
  }
  private async number(sql: string): Promise<number> {
    const rows = await this.db.querySql(sql);
    try { if (!rows.goToFirstRow()) throw new Error('Guardian metadata unavailable'); return rows.getLong(0); }
    finally { rows.close(); }
  }
  private async format(): Promise<void> {
    if (await this.number('PRAGMA application_id') !== APP_ID || await this.number('PRAGMA user_version') !== 1) {
      throw new Error('Unsupported native guardian format');
    }
    const rows = await this.db.querySql('PRAGMA table_info(native_guardian_state)');
    const columns: string[] = [];
    try { if (rows.goToFirstRow()) do { columns.push(rows.getString(rows.getColumnIndex('name'))); } while (rows.goToNextRow()); }
    finally { rows.close(); }
    if (JSON.stringify(columns) !== JSON.stringify(['id', 'scope_id', 'revision', 'payload'])) throw new Error('Unsupported native guardian schema');
  }
  private async initialize(): Promise<void> {
    this.db.beginTransaction();
    try {
      const appId = await this.number('PRAGMA application_id'), version = await this.number('PRAGMA user_version');
      if (appId === 0 && version === 0) {
        const count = await this.number("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        if (count !== 0) throw new Error('Existing native data is not a new guardian store');
        const text = createGuardianPayload();
        await this.db.executeSql('CREATE TABLE native_guardian_state (id INTEGER PRIMARY KEY CHECK(id=1), scope_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL)');
        await this.db.executeSql('PRAGMA application_id = ' + APP_ID.toString());
        await this.db.executeSql('PRAGMA user_version = 1');
        await this.db.executeSql('INSERT INTO native_guardian_state VALUES (1, ?, 0, ?)', [SCOPE, text]);
      }
      await this.row(); this.db.commit();
    } catch (error) { try { this.db.rollBack(); } catch {} throw error; }
  }
  private async row(): Promise<string> {
    await this.format();
    const rows = await this.db.querySql('SELECT id,scope_id,revision,payload FROM native_guardian_state');
    try {
      if (rows.rowCount !== 1 || !rows.goToFirstRow() || rows.getLong(0) !== 1) throw new Error('Invalid native guardian row');
      const scope = rows.getString(1), revision = rows.getLong(2), text = rows.getString(3), state = validateGuardianPayload(text);
      if (scope !== SCOPE || state.revision !== revision) throw new Error('Inconsistent native guardian row');
      return text;
    } finally { rows.close(); }
  }
  read(): Promise<GuardianState> { return this.exclusive(async () => validateGuardianPayload(await this.row())); }
  compareAndSwap(revision: number, state: GuardianState): Promise<boolean> {
    const scopeId = SCOPE, text = JSON.stringify(state);
    return this.exclusive(async () => {
      // Credentials, immutable first answers, practice grants and rest/day counters share this CAS.
      const next = validateGuardianPayload(text);
      if (scopeId !== SCOPE || !Number.isSafeInteger(revision) || revision < 0 || next.revision !== revision + 1) throw new Error('Invalid native guardian replacement');
      this.db.beginTransaction();
      try {
        const previous = validateGuardianPayload(await this.row());
        if (previous.revision !== revision) { this.db.rollBack(); return false; }
        await this.db.executeSql('UPDATE native_guardian_state SET revision=?,payload=? WHERE id=1 AND scope_id=? AND revision=?', [next.revision, text, scopeId, revision]);
        if (await this.number('SELECT changes()') !== 1) throw new Error('Native queue CAS was not confirmed');
        this.db.commit(); return true;
      } catch (error) { try { this.db.rollBack(); } catch {} throw error; }
    });
  }
}
