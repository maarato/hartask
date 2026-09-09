import { getDb } from '@/lib/db/client';
import {
  localOrigin,
  newUuid,
  nextLamport,
  observeLamport,
  registerOrigin
} from '@/lib/hartask/sync/identity';

/**
 * Bidirectional sync between two Hartask databases.
 *
 * Rows fall into two shapes. Tasks, prompts and prompt runs are mutable, so
 * they can conflict and resolve last-write-wins on (lamport, origin). Notes,
 * events and handoffs are append-only and merge as a union by uuid. Nothing is
 * ever deleted in Hartask — archiving is a field — so there are no tombstones.
 *
 * Conflict resolution is per row, not per field: two origins editing different
 * fields of one row keep one version and discard the other. The discarded one
 * is not lost — it is written to the history as a SYNC_CONFLICT event, so the
 * side that applies a losing row never drops work silently.
 *
 * Known limit: exporting marks the rows it sends as agreed with the peer,
 * which is an approximation — the peer may still reject them. If A's version
 * beats B's and B later receives it, B applies it without flagging a conflict,
 * because from B's side it looks like ordinary propagation. Detecting that
 * would need version vectors rather than a single clock per row. Convergence
 * is unaffected: both sides still end on the same value.
 */

export type SyncedRow = Record<string, unknown> & {
  uuid: string;
  origin: string;
  lamport: number;
};

export type TaskRow = SyncedRow & { public_id: string; parent_uuid: string | null };
export type AppendRow = SyncedRow;

export type Changeset = {
  origin: string;
  origin_label: string;
  lamport: number;
  tasks: TaskRow[];
  prompts: SyncedRow[];
  prompt_runs: SyncedRow[];
  notes: AppendRow[];
  events: AppendRow[];
  handoffs: AppendRow[];
};

export type TableMerge = { inserted: number; updated: number; skipped: number; conflicts: number };

export type MergeResult = {
  tasks: TableMerge;
  prompts: TableMerge;
  prompt_runs: TableMerge;
  notes: number;
  events: number;
  handoffs: number;
};

/**
 * A mutable table: which columns travel, how its foreign key is carried as a
 * uuid, and which fields count as a real difference when deciding whether a
 * merge overwrote local work. Timestamps stay out of that comparison because
 * they move on every write.
 */
type MutableSpec = {
  table: string;
  columns: string[];
  conflictFields: string[];
  link: { column: string; uuidField: string; table: string } | null;
  hasPublicId?: boolean;
  /** Two origins holding the same queued work is worth its own record. */
  claimField?: string;
};

const MUTABLE: MutableSpec[] = [
  {
    table: 'tasks',
    columns: [
      'public_id',
      'title',
      'description',
      'status',
      'priority',
      'next_action',
      'blocked_reason',
      'category',
      'archived_at',
      'created_at',
      'updated_at'
    ],
    conflictFields: [
      'title',
      'description',
      'status',
      'priority',
      'next_action',
      'blocked_reason',
      'category',
      'archived_at'
    ],
    link: { column: 'parent_id', uuidField: 'parent_uuid', table: 'tasks' },
    hasPublicId: true
  },
  {
    table: 'prompts',
    columns: [
      'title',
      'prompt',
      'status',
      'priority',
      'position',
      'claimed_by',
      'claimed_at',
      'created_at',
      'updated_at'
    ],
    conflictFields: ['title', 'prompt', 'status', 'priority', 'position', 'claimed_by'],
    link: { column: 'task_id', uuidField: 'task_uuid', table: 'tasks' },
    claimField: 'claimed_by'
  },
  {
    table: 'prompt_runs',
    columns: ['agent_id', 'status', 'summary', 'error', 'started_at', 'finished_at'],
    conflictFields: ['agent_id', 'status', 'summary', 'error', 'finished_at'],
    link: { column: 'prompt_id', uuidField: 'prompt_uuid', table: 'prompts' }
  }
];

type AppendKey = 'notes' | 'events' | 'handoffs';

const APPEND: { key: AppendKey; table: string; columns: string[]; link: string }[] = [
  {
    key: 'notes',
    table: 'task_notes',
    columns: ['task_id', 'body', 'author_type', 'created_at'],
    link: 'task_id'
  },
  {
    key: 'events',
    table: 'task_events',
    columns: ['task_id', 'event_type', 'summary', 'payload_json', 'agent_id', 'created_at'],
    link: 'task_id'
  },
  {
    key: 'handoffs',
    table: 'project_handoff',
    columns: [
      'current_task_id',
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
    ],
    link: 'current_task_id'
  }
];

function emptyMerge(): TableMerge {
  return { inserted: 0, updated: 0, skipped: 0, conflicts: 0 };
}

/**
 * Everything written locally at or after the given clock value.
 *
 * The bound is inclusive on purpose: rows that existed before sync was added
 * were stamped by the migration with lamport 0, so an exclusive `> 0` would
 * have quietly excluded every row a project already had.
 */
export function exportChangeset(since = 0): Changeset {
  const db = getDb();
  const origin = localOrigin();

  const exportMutable = (spec: MutableSpec): SyncedRow[] => {
    const select = ['r.uuid', 'r.origin', 'r.lamport', ...spec.columns.map((c) => `r.${c}`)];
    const join = spec.link ? `LEFT JOIN ${spec.link.table} l ON l.id = r.${spec.link.column}` : '';
    if (spec.link) select.push(`l.uuid AS ${spec.link.uuidField}`);

    const rows = db
      .prepare(`SELECT ${select.join(', ')} FROM ${spec.table} r ${join} WHERE r.lamport >= ?`)
      .all(since) as SyncedRow[];

    // Everything leaving here is a version a peer knows about, so later local
    // edits are distinguishable from it.
    const agree = db.prepare(`UPDATE ${spec.table} SET synced_lamport = lamport WHERE uuid = ?`);
    for (const row of rows) agree.run(row.uuid);

    return rows;
  };

  // Row ids are per-database, so every link travels as the target's uuid.
  const exportAppend = (table: string, linkColumn: string) =>
    db
      .prepare(
        `SELECT r.*, t.uuid AS task_uuid FROM ${table} r
         LEFT JOIN tasks t ON t.id = r.${linkColumn} WHERE r.lamport >= ?`
      )
      .all(since) as AppendRow[];

  return {
    origin: origin.id,
    origin_label: origin.label,
    lamport: Math.max(origin.lamport, 0),
    tasks: exportMutable(MUTABLE[0]) as TaskRow[],
    prompts: exportMutable(MUTABLE[1]),
    prompt_runs: exportMutable(MUTABLE[2]),
    notes: exportAppend('task_notes', 'task_id'),
    events: exportAppend('task_events', 'task_id'),
    handoffs: exportAppend('project_handoff', 'current_task_id')
  };
}

/**
 * Two databases that were never paired both believe they are the original, so
 * both mint TASK-001. When an incoming id is already taken by a different task,
 * the arriving one is relabelled into a free local slot.
 *
 * Only tasks created before the two origins ever met can collide; after
 * pairing each origin mints in its own prefixed range. Those pre-pairing ids
 * are not renamed on the side that owns them, because renaming would break
 * every reference to them, so the two peers can end up showing different
 * labels for one task. The uuid is the identity that always agrees, and
 * getTaskByRef accepts either — public_id is a label, not a global id.
 */
function publicIdFor(incoming: TaskRow): string {
  const db = getDb();
  const taken = db
    .prepare(`SELECT uuid FROM tasks WHERE public_id = ?`)
    .get(incoming.public_id) as { uuid: string } | undefined;

  if (!taken || taken.uuid === incoming.uuid) return incoming.public_id;

  const relabelled = mintLocalPublicId();
  db.prepare(
    `INSERT INTO task_events (uuid, origin, lamport, event_type, summary, payload_json, agent_id)
     VALUES (?, ?, ?, 'SYNC_RENUMBERED', ?, ?, 'sync')`
  ).run(
    newUuid(),
    localOrigin().id,
    nextLamport(),
    `${incoming.public_id} ya existía aquí; la task entrante quedó como ${relabelled}`,
    JSON.stringify({ uuid: incoming.uuid, from: incoming.public_id, to: relabelled })
  );
  return relabelled;
}

/** A free id in this origin's own range. */
function mintLocalPublicId(): string {
  const db = getDb();
  const head = `TASK-${localOrigin().public_id_prefix}`;
  const row = db
    .prepare(
      `SELECT public_id FROM tasks WHERE public_id GLOB ?
       ORDER BY CAST(SUBSTR(public_id, ?) AS INTEGER) DESC LIMIT 1`
    )
    .get(`${head}[0-9]*`, head.length + 1) as { public_id: string } | undefined;

  const next = row ? Number.parseInt(row.public_id.slice(head.length), 10) + 1 : 1;
  return `${head}${String(next).padStart(3, '0')}`;
}

/** Later write wins; the origin id breaks a tie so both sides decide the same. */
function incomingWins(incoming: SyncedRow, local: { lamport: number; origin: string }): boolean {
  if (incoming.lamport !== local.lamport) return incoming.lamport > local.lamport;
  return incoming.origin > local.origin;
}

function differs(incoming: SyncedRow, local: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => (incoming[field] ?? null) !== (local[field] ?? null));
}

function recordSyncEvent(
  type: string,
  summary: string,
  payload: unknown,
  taskId: number | null
): void {
  getDb()
    .prepare(
      `INSERT INTO task_events (uuid, origin, lamport, task_id, event_type, summary, payload_json, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'sync')`
    )
    .run(newUuid(), localOrigin().id, nextLamport(), taskId, type, summary, JSON.stringify(payload));
}

function mergeMutable(spec: MutableSpec, rows: SyncedRow[], peer: string): TableMerge {
  const db = getDb();
  const result = emptyMerge();
  const find = db.prepare(`SELECT * FROM ${spec.table} WHERE uuid = ?`);
  const columns = spec.columns;

  for (const incoming of rows) {
    const local = find.get(incoming.uuid) as Record<string, unknown> | undefined;

    if (!local) {
      const values = columns.map((column) =>
        spec.hasPublicId && column === 'public_id'
          ? publicIdFor(incoming as TaskRow)
          : (incoming[column] ?? null)
      );

      // Resolve the link now rather than only in the second pass: prompt_runs
      // declares prompt_id NOT NULL, and the merge order already guarantees
      // the target is here. The second pass still catches stragglers.
      const insertColumns = [...columns];
      if (spec.link) {
        insertColumns.push(spec.link.column);
        const target = incoming[spec.link.uuidField] as string | null | undefined;
        const found = target
          ? (db.prepare(`SELECT id FROM ${spec.link.table} WHERE uuid = ?`).get(target) as
              | { id: number }
              | undefined)
          : undefined;
        values.push(found?.id ?? null);
      }

      db.prepare(
        `INSERT INTO ${spec.table} (uuid, origin, lamport, synced_lamport, ${insertColumns.join(', ')})
         VALUES (?, ?, ?, ?, ${insertColumns.map(() => '?').join(', ')})`
      ).run(incoming.uuid, incoming.origin, incoming.lamport, incoming.lamport, ...values);
      result.inserted++;
      continue;
    }

    if (!incomingWins(incoming, local as { lamport: number; origin: string })) {
      result.skipped++;
      continue;
    }

    // A conflict is both sides having moved past the version they last agreed
    // on. Creating a row and never touching it again is not an edit, which is
    // why the comparison is against synced_lamport and not origin.
    const changedLocally = (local.lamport as number) > (local.synced_lamport as number);
    const conflicted = changedLocally && differs(incoming, local, spec.conflictFields);

    // Two origins holding the same queued work means both agents already ran
    // it. Sync cannot undo that, so it is recorded rather than smoothed over.
    const claim = spec.claimField;
    const doubleClaim =
      claim !== undefined &&
      Boolean(local[claim]) &&
      Boolean(incoming[claim]) &&
      local[claim] !== incoming[claim];

    db.prepare(
      `UPDATE ${spec.table} SET origin = ?, lamport = ?, synced_lamport = ?,
         ${columns.map((c) => `${c} = ?`).join(', ')}
       WHERE uuid = ?`
    ).run(
      incoming.origin,
      incoming.lamport,
      incoming.lamport,
      ...columns.map((column) => (incoming[column] ?? null) as unknown),
      incoming.uuid
    );
    result.updated++;

    if (doubleClaim && claim) {
      recordSyncEvent(
        'SYNC_DOUBLE_CLAIM',
        `El mismo trabajo encolado fue reclamado por ${String(local[claim])} y por ${String(incoming[claim])}`,
        {
          table: spec.table,
          uuid: incoming.uuid,
          local_claim: local[claim],
          remote_claim: incoming[claim]
        },
        null
      );
      result.conflicts++;
    } else if (conflicted) {
      recordSyncEvent(
        'SYNC_CONFLICT',
        `${spec.table}: la versión local fue reemplazada por ${peer}`,
        { table: spec.table, discarded_local: local, applied_remote: incoming },
        spec.table === 'tasks' ? (local.id as number) : null
      );
      result.conflicts++;
    }
  }

  return result;
}

/** Resolves uuid links to local row ids, once every row in the set exists. */
function resolveLinks(spec: MutableSpec, rows: SyncedRow[]): void {
  if (!spec.link) return;
  const db = getDb();
  const update = db.prepare(
    `UPDATE ${spec.table} SET ${spec.link.column} = (SELECT id FROM ${spec.link.table} WHERE uuid = ?)
     WHERE uuid = ?`
  );
  for (const row of rows) {
    const target = row[spec.link.uuidField] as string | null | undefined;
    if (target) update.run(target, row.uuid);
  }
}

export function applyChangeset(changeset: Changeset): MergeResult {
  const db = getDb();
  registerOrigin(changeset.origin, changeset.origin_label);

  const result: MergeResult = {
    tasks: emptyMerge(),
    prompts: emptyMerge(),
    prompt_runs: emptyMerge(),
    notes: 0,
    events: 0,
    handoffs: 0
  };

  const run = db.transaction(() => {
    // A changeset from an older peer may not carry the newer tables at all.
    const sets: SyncedRow[][] = [
      changeset.tasks ?? [],
      changeset.prompts ?? [],
      changeset.prompt_runs ?? []
    ];

    MUTABLE.forEach((spec, index) => {
      const merged = mergeMutable(spec, sets[index], changeset.origin_label);
      if (spec.table === 'tasks') result.tasks = merged;
      else if (spec.table === 'prompts') result.prompts = merged;
      else result.prompt_runs = merged;
    });

    // Second pass: a link's target may have arrived in the same changeset, so
    // it is resolved only once every row exists.
    MUTABLE.forEach((spec, index) => resolveLinks(spec, sets[index]));

    for (const append of APPEND) {
      result[append.key] = insertAppendOnly(
        changeset[append.key] ?? [],
        append.table,
        append.columns
      );
    }

    observeLamport(changeset.lamport);
  });

  run();
  return result;
}

/**
 * Append-only tables merge as a union by uuid: a row that is already here was
 * already merged, and rows are never edited after they are written.
 *
 * task_id is carried as task_uuid because row ids are per-database; a row
 * whose task has not arrived yet keeps a null link rather than pointing at
 * whatever happens to hold that id locally.
 */
function insertAppendOnly(rows: AppendRow[], table: string, columns: string[]): number {
  const db = getDb();
  const exists = db.prepare(`SELECT 1 FROM ${table} WHERE uuid = ?`);
  const taskIdOf = db.prepare(`SELECT id FROM tasks WHERE uuid = ?`);
  let inserted = 0;

  for (const row of rows) {
    if (exists.get(row.uuid)) continue;

    const values = columns.map((column) => {
      if (column === 'task_id' || column === 'current_task_id') {
        const uuid = row.task_uuid as string | null;
        const task = uuid ? (taskIdOf.get(uuid) as { id: number } | undefined) : undefined;
        return task?.id ?? null;
      }
      return (row[column] ?? null) as unknown;
    });

    db.prepare(
      `INSERT INTO ${table} (uuid, origin, lamport, ${columns.join(', ')})
       VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})`
    ).run(row.uuid, row.origin as string, row.lamport, ...values);
    inserted++;
  }

  return inserted;
}
