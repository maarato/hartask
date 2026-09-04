import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { databasePath } from '@/lib/hartask/config';

type DbHandle = Database.Database;

// Next.js dev reloads modules on every edit; cache the handle on globalThis so
// we do not leak a new SQLite connection per hot reload.
const globalForDb = globalThis as unknown as { hartaskDb?: DbHandle };

/**
 * Columns added after the initial schema. `CREATE TABLE IF NOT EXISTS` leaves
 * an existing table untouched, so a database created before a column existed
 * would silently lack it — and the Hartask database holds project state that
 * must not be thrown away to pick up a change.
 *
 * Additive only: adding a column is safe to run on every boot. Anything that
 * rewrites or drops data needs a real versioned migration instead.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'tasks', column: 'archived_at', definition: 'TEXT' }
];

function migrate(db: DbHandle): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((existing) => existing.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function open(): DbHandle {
  const file = databasePath();
  mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Schema statements are all IF NOT EXISTS, so this is safe on every boot and
  // means the app works even if `npm run db:init` was never executed.
  db.exec(readFileSync(resolve(process.cwd(), 'lib/db/schema.sql'), 'utf8'));
  migrate(db);

  return db;
}

export function getDb(): DbHandle {
  if (!globalForDb.hartaskDb) globalForDb.hartaskDb = open();
  return globalForDb.hartaskDb;
}
