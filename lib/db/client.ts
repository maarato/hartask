import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { databasePath } from '@/lib/hartask/config';
import { uuidForName } from '@/lib/hartask/sync/uuid';

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
  { table: 'tasks', column: 'archived_at', definition: 'TEXT' },
  { table: 'tasks', column: 'category', definition: 'TEXT' },
  { table: 'shared_contexts', column: 'kind', definition: "TEXT NOT NULL DEFAULT 'doc'" },
  { table: 'projects', column: 'uuid', definition: 'TEXT' },
  { table: 'tasks', column: 'uuid', definition: 'TEXT' },
  { table: 'tasks', column: 'origin', definition: 'TEXT' },
  { table: 'tasks', column: 'lamport', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tasks', column: 'synced_lamport', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'task_notes', column: 'uuid', definition: 'TEXT' },
  { table: 'task_notes', column: 'origin', definition: 'TEXT' },
  { table: 'task_notes', column: 'lamport', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'task_events', column: 'uuid', definition: 'TEXT' },
  { table: 'task_events', column: 'origin', definition: 'TEXT' },
  { table: 'task_events', column: 'lamport', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'project_handoff', column: 'uuid', definition: 'TEXT' },
  { table: 'project_handoff', column: 'origin', definition: 'TEXT' },
  { table: 'project_handoff', column: 'lamport', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'prompts', column: 'uuid', definition: 'TEXT' },
  { table: 'prompts', column: 'origin', definition: 'TEXT' },
  { table: 'prompts', column: 'lamport', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'prompts', column: 'synced_lamport', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'prompt_runs', column: 'uuid', definition: 'TEXT' },
  { table: 'prompt_runs', column: 'origin', definition: 'TEXT' },
  { table: 'prompt_runs', column: 'lamport', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'prompt_runs', column: 'synced_lamport', definition: 'INTEGER NOT NULL DEFAULT 0' }
];

/** Tables whose rows are identified across origins by a uuid. */
const SYNCED_TABLES = [
  'projects',
  'tasks',
  'task_notes',
  'task_events',
  'project_handoff',
  'prompts',
  'prompt_runs',
  'shared_contexts'
];

function addColumns(db: DbHandle): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((existing) => existing.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Rows written before sync existed have no identity. They belong to this
 * database, so they are stamped with the local origin — and must be stamped
 * before the unique index on uuid can be created.
 */
function backfillIdentity(db: DbHandle): string {
  let local = db.prepare(`SELECT id FROM sync_origins WHERE is_local = 1`).get() as
    | { id: string }
    | undefined;

  if (!local) {
    local = { id: randomUUID() };
    db.prepare(
      `INSERT INTO sync_origins (id, label, public_id_prefix, is_local, lamport)
       VALUES (?, 'local', '', 1, 0)`
    ).run(local.id);
  }

  for (const table of SYNCED_TABLES) {
    const rows = db.prepare(`SELECT id FROM ${table} WHERE uuid IS NULL`).all() as { id: number }[];
    if (!rows.length) continue;

    const stamp = db.prepare(`UPDATE ${table} SET uuid = ? WHERE id = ?`);
    const run = db.transaction(() => {
      for (const row of rows) stamp.run(randomUUID(), row.id);
      if (table !== 'projects') {
        db.prepare(`UPDATE ${table} SET origin = ? WHERE origin IS NULL`).run(local.id);
      }
    });
    run();
  }

  return local.id;
}

/**
 * Gives a shared context the identity its slug implies.
 *
 * Documents written before the identity was derived from the name carry a
 * random uuid, so two machines writing the same document would reach the store
 * as two rows under one name. Rewriting a uuid is normally out of bounds — it
 * is what a row is known by everywhere — so this only touches rows that have
 * never synced, which is exactly the set for which no one else has an opinion
 * about their identity yet.
 */
function realignContextIdentity(db: DbHandle): void {
  const project = db.prepare(`SELECT uuid FROM projects LIMIT 1`).get() as
    | { uuid: string | null }
    | undefined;
  if (!project?.uuid) return;

  const rows = db
    .prepare(`SELECT id, slug, uuid FROM shared_contexts WHERE synced_lamport = 0`)
    .all() as { id: number; slug: string; uuid: string | null }[];

  const stamp = db.prepare(`UPDATE shared_contexts SET uuid = ? WHERE id = ?`);
  for (const row of rows) {
    const derived = uuidForName(project.uuid, row.slug);
    if (row.uuid === derived) continue;
    stamp.run(derived, row.id);
  }
}

function createIndexes(db: DbHandle): void {
  for (const table of SYNCED_TABLES) {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_uuid ON ${table}(uuid)`);
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

  addColumns(db);
  backfillIdentity(db);
  realignContextIdentity(db);
  // After the backfill, so the index never has to reject pre-existing nulls.
  createIndexes(db);

  return db;
}

export function getDb(): DbHandle {
  if (!globalForDb.hartaskDb) globalForDb.hartaskDb = open();
  return globalForDb.hartaskDb;
}

/**
 * Drops the cached connection so the next call opens whatever HARTASK_DATABASE
 * now points at. Sync tests need it: proving a merge works means driving two
 * databases from one process.
 */
export function closeDb(): void {
  globalForDb.hartaskDb?.close();
  globalForDb.hartaskDb = undefined;
}
