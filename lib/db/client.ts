import Database from 'better-sqlite3';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { databasePath } from '@/lib/hartask/config';

type DbHandle = Database.Database;

// Next.js dev reloads modules on every edit; cache the handle on globalThis so
// we do not leak a new SQLite connection per hot reload.
const globalForDb = globalThis as unknown as { hartaskDb?: DbHandle };

function open(): DbHandle {
  const file = databasePath();
  mkdirSync(dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Schema statements are all IF NOT EXISTS, so this is safe on every boot and
  // means the app works even if `npm run db:init` was never executed.
  db.exec(readFileSync(resolve(process.cwd(), 'lib/db/schema.sql'), 'utf8'));

  return db;
}

export function getDb(): DbHandle {
  if (!globalForDb.hartaskDb) globalForDb.hartaskDb = open();
  return globalForDb.hartaskDb;
}
