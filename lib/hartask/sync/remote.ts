import { createClient, type Client, type InValue } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { syncSettings } from '@/lib/hartask/config';
import { adoptProjectUuid, ensureProject } from '@/lib/hartask/repositories/projects';
import { listTasks, recordEvent } from '@/lib/hartask/repositories/tasks';
import {
  applyChangeset,
  exportChangeset,
  syncedColumns,
  type AppendRow,
  type Changeset,
  type MergeResult,
  type SyncedRow,
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
     created_at TEXT,
     updated_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS tasks (
     uuid TEXT PRIMARY KEY,
     project_uuid TEXT NOT NULL,
     origin TEXT, lamport INTEGER NOT NULL DEFAULT 0,
     public_id TEXT NOT NULL, parent_uuid TEXT,
     title TEXT NOT NULL, description TEXT, status TEXT NOT NULL,
     priority INTEGER NOT NULL DEFAULT 0, next_action TEXT, blocked_reason TEXT,
     category TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT
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
  `CREATE TABLE IF NOT EXISTS prompts (
     uuid TEXT PRIMARY KEY,
     project_uuid TEXT NOT NULL,
     origin TEXT, lamport INTEGER NOT NULL DEFAULT 0,
     task_uuid TEXT, title TEXT, prompt TEXT NOT NULL, status TEXT NOT NULL,
     priority INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
     claimed_by TEXT, claimed_at TEXT, created_at TEXT, updated_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS prompt_runs (
     uuid TEXT PRIMARY KEY,
     project_uuid TEXT NOT NULL,
     origin TEXT, lamport INTEGER NOT NULL DEFAULT 0,
     prompt_uuid TEXT, agent_id TEXT, status TEXT NOT NULL,
     summary TEXT, error TEXT, started_at TEXT, finished_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS shared_contexts (
     uuid TEXT PRIMARY KEY,
     project_uuid TEXT NOT NULL,
     origin TEXT, lamport INTEGER NOT NULL DEFAULT 0,
     slug TEXT NOT NULL, title TEXT NOT NULL, purpose TEXT, body TEXT,
     category TEXT, valid_as_of TEXT, created_at TEXT, updated_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_contexts_project ON shared_contexts(project_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_runs_project ON prompt_runs(project_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_project ON task_notes(project_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_events_project ON task_events(project_uuid)`,
  `CREATE INDEX IF NOT EXISTS idx_handoff_project ON project_handoff(project_uuid)`
];

/**
 * Columns added to the remote after a store already existed.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that is already there,
 * so without this a new column would simply never reach a store that had been
 * synced before — the push would keep succeeding and quietly drop the value.
 * Same shape and same rule as ADDED_COLUMNS locally: additive only.
 */
const REMOTE_ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  { table: 'tasks', column: 'category', definition: 'TEXT' }
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

  for (const { table, column, definition } of REMOTE_ADDED_COLUMNS) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    if (info.rows.some((row) => row.name === column)) continue;
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

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
  const prompts = (await query('prompts')) as unknown as SyncedRow[];
  const promptRuns = (await query('prompt_runs')) as unknown as SyncedRow[];
  const contexts = (await query('shared_contexts')) as unknown as SyncedRow[];
  const notes = (await query('task_notes')) as unknown as AppendRow[];
  const events = (await query('task_events')) as unknown as AppendRow[];
  const handoffs = (await query('project_handoff')) as unknown as AppendRow[];

  const lamports = [
    ...tasks,
    ...prompts,
    ...promptRuns,
    ...contexts,
    ...notes,
    ...events,
    ...handoffs
  ].map((row) => Number(row.lamport));

  return {
    origin: storeOrigin,
    origin_label: 'remote store',
    lamport: Math.max(...lamports, 0),
    tasks,
    prompts,
    prompt_runs: promptRuns,
    shared_contexts: contexts,
    notes,
    events,
    handoffs
  };
}

async function writeRemote(
  client: Client,
  projectUuid: string,
  local: Changeset,
  project: { name: string; summary: string | null; created_at: string; updated_at: string }
): Promise<number> {
  const statements: { sql: string; args: InValue[] }[] = [
    {
      sql: `INSERT INTO projects (uuid, name, summary, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(uuid) DO UPDATE SET name = excluded.name, summary = excluded.summary,
                                            created_at = excluded.created_at,
                                            updated_at = excluded.updated_at`,
      args: [projectUuid, project.name, project.summary, project.created_at, project.updated_at]
    }
  ];

  // Mutable tables upsert: after the local merge this database already holds
  // the winning version, so the remote copy is simply overwritten.
  const MUTABLE_REMOTE = [
    { table: 'tasks', rows: local.tasks as unknown as Record<string, unknown>[] },
    { table: 'prompts', rows: local.prompts as unknown as Record<string, unknown>[] },
    { table: 'prompt_runs', rows: local.prompt_runs as unknown as Record<string, unknown>[] },
    { table: 'shared_contexts', rows: local.shared_contexts as unknown as Record<string, unknown>[] }
  ].map(({ table, rows }) => ({ table, rows, columns: syncedColumns(table) }));

  for (const { table, rows, columns } of MUTABLE_REMOTE) {
    for (const row of rows) {
      const all = ['uuid', 'project_uuid', 'origin', 'lamport', ...columns];
      statements.push({
        sql: `INSERT INTO ${table} (${all.join(', ')})
              VALUES (${all.map(() => '?').join(', ')})
              ON CONFLICT(uuid) DO UPDATE SET
                ${[...columns, 'origin', 'lamport'].map((c) => `${c} = excluded.${c}`).join(', ')}`,
        args: [
          value(row, 'uuid'),
          projectUuid,
          value(row, 'origin'),
          value(row, 'lamport'),
          ...columns.map((column) => value(row, column))
        ]
      });
    }
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

/**
 * A refusal the caller can tell apart from a transport failure: nothing is
 * wrong with the network, the configuration is wrong.
 */
export class SyncRefusedError extends Error {
  readonly refused = true;
}

/**
 * Refuses to fold this project's board into another project's scope.
 *
 * HARTASK_SYNC_PROJECT_ID is for a second machine joining a project that
 * already exists in the store, and such a machine starts empty. A database
 * that already has tasks of its own, pointed at someone else's project id, is
 * almost always a .env.local copied from another project — and going ahead
 * would merge two boards into one, which no later sync can undo.
 *
 * The way out is a parameter of this call, never a setting: a setting is the
 * thing that gets copied, and would carry the override along with the mistake.
 */
function guardProjectAdoption(configuredId: string, adopt: boolean): void {
  const project = ensureProject();
  if (project.uuid === configuredId) return;

  const local = listTasks({ includeArchived: true }).length;
  if (local === 0) return;

  if (adopt) {
    recordEvent({
      eventType: 'SYNC_PROJECT_ADOPTED',
      summary: `Este board pasó al proyecto ${configuredId} a pedido explícito`,
      payload: { from: project.uuid, to: configuredId, local_tasks: local },
      agentId: 'sync'
    });
    return;
  }

  recordEvent({
    eventType: 'SYNC_REFUSED',
    summary: 'Sincronización detenida: el id de proyecto configurado es de otro board',
    payload: { local_project: project.uuid, configured: configuredId, local_tasks: local },
    agentId: 'sync'
  });

  throw new SyncRefusedError(
    `Sync stopped: HARTASK_SYNC_PROJECT_ID is ${configuredId}, but this database already has ` +
      `${local} task(s) of its own under project ${project.uuid}. Going ahead would merge two ` +
      `boards into one project, and no later sync can separate them again.

` +
      `If this is a new project: unset HARTASK_SYNC_PROJECT_ID. It is only for a second machine ` +
      `joining a project that already exists in the store, and such a machine starts empty.
` +
      `If you did mean to move this board into that project: sync once with {"adopt_project": true}.`
  );
}

export type RemoteSyncOutcome = {
  url: string;
  project_uuid: string;
  pulled: MergeResult;
  pushed: number;
};

export async function syncWithRemoteStore(
  options: { adoptProject?: boolean } = {}
): Promise<RemoteSyncOutcome> {
  const { url, projectId } = syncSettings();

  // A second machine joins an existing project by being told its id: every
  // database mints its own, so without this it would sync against an empty
  // scope of its own and see none of the board.
  if (projectId) guardProjectAdoption(projectId, options.adoptProject ?? false);
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
      created_at: project.created_at,
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
