import relationalStore from '@ohos.data.relationalStore';
import common from '@ohos.app.ability.common';
import { ReminderQueueStore, createReminderQueue, validateReminderQueue } from './ReminderDelivery';

const SCOPE = 'web-preview';
const APP_ID = 0x42454152;
/** Candidate API10 encrypted private outbox. This stores reminders, never usage grants or PINs. */
export class NativeReminderStore implements ReminderQueueStore {
  private tail: Promise<void> = Promise.resolve();
  private constructor(private db: relationalStore.RdbStore) {}

  static async open(context: common.UIAbilityContext): Promise<NativeReminderStore> {
    const db = await relationalStore.getRdbStore(context, {
      name: 'beaa-preview-reminders.db', securityLevel: relationalStore.SecurityLevel.S3, encrypt: true
    });
    const store = new NativeReminderStore(db);
    await store.initialize();
    return store;
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work); this.tail = next.then(() => {}, () => {}); return next;
  }
  private async number(sql: string): Promise<number> {
    const rows = await this.db.querySql(sql);
    try { if (!rows.goToFirstRow()) throw new Error('Reminder metadata unavailable'); return rows.getLong(0); }
    finally { rows.close(); }
  }
  private async format(): Promise<void> {
    if (await this.number('PRAGMA application_id') !== APP_ID || await this.number('PRAGMA user_version') !== 1) {
      throw new Error('Unsupported native reminder format');
    }
    const rows = await this.db.querySql('PRAGMA table_info(native_reminder_queue)');
    const columns: string[] = [];
    try { if (rows.goToFirstRow()) do { columns.push(rows.getString(rows.getColumnIndex('name'))); } while (rows.goToNextRow()); }
    finally { rows.close(); }
    if (JSON.stringify(columns) !== JSON.stringify(['id', 'scope_id', 'revision', 'payload'])) throw new Error('Unsupported native reminder schema');
  }
  private async initialize(): Promise<void> {
    this.db.beginTransaction();
    try {
      const appId = await this.number('PRAGMA application_id'), version = await this.number('PRAGMA user_version');
      if (appId === 0 && version === 0) {
        const count = await this.number("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        if (count !== 0) throw new Error('Existing native data is not a new queue');
        const text = createReminderQueue(SCOPE);
        await this.db.executeSql('CREATE TABLE native_reminder_queue (id INTEGER PRIMARY KEY CHECK(id=1), scope_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL)');
        await this.db.executeSql('PRAGMA application_id = ' + APP_ID.toString());
        await this.db.executeSql('PRAGMA user_version = 1');
        await this.db.executeSql('INSERT INTO native_reminder_queue VALUES (1, ?, 0, ?)', [SCOPE, text]);
      }
      await this.row(); this.db.commit();
    } catch (error) { try { this.db.rollBack(); } catch {} throw error; }
  }
  private async row(): Promise<string> {
    await this.format();
    const rows = await this.db.querySql('SELECT id,scope_id,revision,payload FROM native_reminder_queue');
    try {
      if (rows.rowCount !== 1 || !rows.goToFirstRow() || rows.getLong(0) !== 1) throw new Error('Invalid native reminder row');
      const scope = rows.getString(1), revision = rows.getLong(2), text = rows.getString(3), state = validateReminderQueue(text);
      if (scope !== SCOPE || state.scopeId !== scope || state.revision !== revision) throw new Error('Inconsistent native reminder row');
      return text;
    } finally { rows.close(); }
  }
  read(): Promise<string> { return this.exclusive(() => this.row()); }
  compareAndSwap(scopeId: string, revision: number, text: string): Promise<boolean> {
    return this.exclusive(async () => {
      const next = validateReminderQueue(text);
      if (scopeId !== SCOPE || !Number.isSafeInteger(revision) || revision < 0 || next.scopeId !== scopeId || next.revision !== revision + 1) throw new Error('Invalid native queue replacement');
      this.db.beginTransaction();
      try {
        const previous = validateReminderQueue(await this.row());
        if (previous.revision !== revision) { this.db.rollBack(); return false; }
        await this.db.executeSql('UPDATE native_reminder_queue SET revision=?,payload=? WHERE id=1 AND scope_id=? AND revision=?', [next.revision, text, scopeId, revision]);
        if (await this.number('SELECT changes()') !== 1) throw new Error('Native queue CAS was not confirmed');
        this.db.commit(); return true;
      } catch (error) { try { this.db.rollBack(); } catch {} throw error; }
    });
  }
}
