import { createClient, type Client, type InValue } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { syncSettings } from '@/lib/hartask/config';
import { adoptProjectUuid, ensureProject } from '@/lib/hartask/repositories/projects';
import { recordEvent } from '@/lib/hartask/repositories/tasks';
import {
  applyChangeset,
  exportChangeset,
  type AppendRow,
  type Changeset,
  type MergeResult,
  type TaskRow
} from '@/lib/hartask/sync/changeset';

/**
 * Syncing against a passive database — Turso/libSQL — rather than another
 * Hartask instance.
 *
 * Hartask always runs locally; only the database lives in the cloud. So the
 * merge still happens here, against local SQLite, using the same engine the
 * peer transport uses. The remote is storage: we read its rows, merge them
 * locally, and write the merged result back.
 *
 * That ordering is what makes the push trivial. After merging, this database
 * holds the winning version of every row it knows about, so pushing is a plain
 * upsert rather than a second round of conflict resolution.
 *
 * The remote holds many projects, so every row is scoped by project_uuid. The
 * local schema stays single-project: that scope only means something once
 * several projects share one store.
 */

/** Row ids are per-database, so the remote stores links as uuids. */
const REMOTE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sync_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS projects (
     uuid TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     summary TEXT,
     updated_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS tasks (
     uuid TEXT PRIMARY KEY,
     project_uuid TEXT NOT NULL,
     origin TEXT, lamport INTEGER NOT NULL DEFAULT 0,
     public_id TEXT NOT NULL, parent_uuid TEXT,
     title TEXT NOT NULL, description TEXT, status TEXT NOT NULL,
     priority INTEGER NOT NULL DEFAULT 0, next_action TEXT, blocked_reason TEXT,
     archived_at TEXT, created_at TEXT, updated_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS task_notes (
     uuid TEXT PRIMARY KEY,
     project_uuid TEXT NOT NULL,
     origin TEXT, lamport INTEGER NOT NULL DEFAULT 0,
     task_uuid TEXT, body TEXT NOT NULL, author_type TEXT, created_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS task_events (
     uuid TEXT PRIMARY KEY,
     project_uuid TEXT NOT NULL,
     origin TEXT, lamport INTEGER NOT NULL DEFAULT 0,
     task_uuid TEXT, event_type TEXT NOT NULL, summary TEXT,
     payload_json TEXT, agent_id TEXT, created_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS project_handoff (
     uuid TEXT PRIMARY KEY,
     project_uuid TEXT NOT NULL,
     origin TEXT, lamport INTEGER NOT NULL DEFAULT 0,
     task_uuid TEXT, what_was_done TEXT, current_state TEXT, next_step TEXT,
     known_problems TEXT, important_files_json TEXT, important_decisions TEXT,
     source TEXT, agent_run_id TEXT, created_at TEXT, updated_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_project ON task_notes(project_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_events_project ON task_events(project_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_handoff_project ON project_handoff(project_uuid)`
];

const APPEND_COLUMNS = {
  task_notes: ['task_uuid', 'body', 'author_type', 'created_at'],
  task_events: [
    'task_uuid',
    'event_type',
    'summary',
    'payload_json',
    'agent_id',
    'created_at'
  ],
  project_handoff: [
    'task_uuid',
    'what_was_done',
    'current_state',
    'next_step',
    'known_problems',
    'important_files_json',
    'important_decisions',
    'source',
    'agent_run_id',
    'created_at',
    'updated_at'
  ]
} as const;

export function isRemoteStoreUrl(url: string): boolean {
  return /^(libsql:|file:|wss?:)/i.test(url.trim());
}

function openRemote(): Client {
  const { url, token } = syncSettings();
  if (!url) throw new Error('No sync URL is configured');
  // A file: URL runs the same code against a local database, which is how the
  // adapter is tested without a Turso instance.
  return createClient({ url, authToken: token || undefined });
}

async function ensureRemoteSchema(client: Client): Promise<string> {
  for (const statement of REMOTE_SCHEMA) await client.execute(statement);

  const existing = await client.execute({
    sql: `SELECT value FROM sync_meta WHERE key = 'store_origin'`,
    args: []
  });
  if (existing.rows.length) return String(existing.rows[0].value);

  // The store is itself an origin, so rows written by whatever else reads this
  // database can be told apart from ours.
  const id = randomUUID();
  await client.execute({
    sql: `INSERT INTO sync_meta (key, value) VALUES ('store_origin', ?)`,
    args: [id]
  });
  return id;
}

/** SQLite only stores primitives, so anything else is a bug worth failing on. */
function value(row: Record<string, unknown>, column: string): InValue {
  const raw = row[column];
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'bigint') return raw;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  throw new Error(`Column ${column} holds a value SQLite cannot store: ${typeof raw}`);
}

async function readRemote(
  client: Client,
  projectUuid: string,
  storeOrigin: string
): Promise<Changeset> {
  const query = async (table: string) =>
    (
      await client.execute({
        sql: `SELECT * FROM ${table} WHERE project_uuid = ?`,
        args: [projectUuid]
      })
    ).rows as unknown as Record<string, unknown>[];

  const tasks = (await query('tasks')) as unknown as TaskRow[];
  const notes = (await query('task_notes')) as unknown as AppendRow[];
  const events = (await query('task_events')) as unknown as AppendRow[];
  const handoffs = (await query('project_handoff')) as unknown as AppendRow[];

  const lamports = [...tasks, ...notes, ...events, ...handoffs].map((row) => Number(row.lamport));

  return {
    origin: storeOrigin,
    origin_label: 'remote store',
    lamport: Math.max(...lamports, 0),
    tasks,
    notes,
    events,
    handoffs
  };
}

async function writeRemote(
  client: Client,
  projectUuid: string,
  local: Changeset,
  project: { name: string; summary: string | null; updated_at: string }
): Promise<number> {
  const statements: { sql: string; args: InValue[] }[] = [
    {
      sql: `INSERT INTO projects (uuid, name, summary, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, summary = excluded.summary,
                                            updated_at = excluded.updated_at`,
      args: [projectUuid, project.name, project.summary, project.updated_at]
    }
  ];

  const taskColumns = [
    'public_id',
    'parent_uuid',
    'title',
    'description',
    'status',
    'priority',
    'next_action',
    'blocked_reason',
    'archived_at',
    'created_at',
    'updated_at'
  ];

  for (const task of local.tasks) {
    const columns = ['uuid', 'project_uuid', 'origin', 'lamport', ...taskColumns];
    statements.push({
      sql: `INSERT INTO tasks (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
            ON CONFLICT(uuid) DO UPDATE SET
              ${[...taskColumns, 'origin', 'lamport'].map((c) => `${c} = excluded.${c}`).join(', ')}`,
      args: [
        task.uuid,
        projectUuid,
        task.origin,
        task.lamport,
        ...taskColumns.map((column) => value(task as unknown as Record<string, unknown>, column))
      ]
    });
  }

  for (const [table, columns] of Object.entries(APPEND_COLUMNS)) {
    const rows =
      table === 'task_notes' ? local.notes : table === 'task_events' ? local.events : local.handoffs;

    for (const row of rows) {
      const all = ['uuid', 'project_uuid', 'origin', 'lamport', ...columns];
      statements.push({
        // Append-only rows are never edited, so an existing uuid needs no write.
        sql: `INSERT OR IGNORE INTO ${table} (${all.join(', ')})
              VALUES (${all.map(() => '?').join(', ')})`,
        args: [
          row.uuid,
          projectUuid,
          (row.origin as string | null) ?? null,
          row.lamport,
          ...columns.map((column) => value(row, column))
        ]
      });
    }
  }

  await client.batch(statements, 'write');
  return statements.length;
}

export type RemoteSyncOutcome = {
  url: string;
  project_uuid: string;
  pulled: MergeResult;
  pushed: number;
};

export async function syncWithRemoteStore(): Promise<RemoteSyncOutcome> {
  const { url, projectId } = syncSettings();

  // A second machine joins an existing project by being told its id: every
  // database mints its own, so without this it would sync against an empty
  // scope of its own and see none of the board.
  const project = projectId ? adoptProjectUuid(projectId) : ensureProject();
  const client = openRemote();

  try {
    const storeOrigin = await ensureRemoteSchema(client);

    // Pull and merge first: afterwards this database holds the winning version
    // of everything, which is what makes the push a plain upsert.
    const incoming = await readRemote(client, project.uuid, storeOrigin);
    const pulled = applyChangeset(incoming);

    const outgoing = exportChangeset(0);
    const pushed = await writeRemote(client, project.uuid, outgoing, {
      name: project.name,
      summary: project.summary,
      updated_at: project.updated_at
    });

    recordEvent({
      eventType: 'SYNC_COMPLETED',
      summary: `Sincronizado con el almacén remoto (${pulled.tasks.inserted + pulled.tasks.updated} entrantes, ${outgoing.tasks.length} tasks enviadas)`,
      payload: { url, project_uuid: project.uuid, pulled, pushed },
      agentId: 'sync'
    });

    return { url, project_uuid: project.uuid, pulled, pushed };
  } finally {
    client.close();
  }
}
