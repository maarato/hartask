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
 * Tasks are the only mutable rows, so they are the only ones that can
 * conflict; notes, events and handoffs are append-only and merge as a union by
 * uuid. Nothing is ever deleted in Hartask — archiving is a field — so there
 * are no tombstones to reconcile.
 *
 * Conflicts resolve last-write-wins on (lamport, origin). That is per row, not
 * per field: two origins editing different fields of the same task will keep
 * one version and discard the other. The discarded one is not lost — it is
 * written to the task's history as a SYNC_CONFLICT event, so the side that
 * applies a losing row never drops work silently.
 *
 * Known limit: exporting marks the rows it sends as agreed with the peer,
 * which is an approximation — the peer may still reject them. If A's version
 * beats B's and B later receives it, B applies it without flagging a conflict,
 * because from B's side it looks like ordinary propagation. Detecting that
 * would need version vectors rather than a single clock per row. Convergence
 * is unaffected: both sides still end on the same value.
 */

export type TaskRow = {
  uuid: string;
  origin: string;
  lamport: number;
  public_id: string;
  parent_uuid: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  next_action: string | null;
  blocked_reason: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppendRow = Record<string, unknown> & { uuid: string; lamport: number };

export type Changeset = {
  origin: string;
  origin_label: string;
  lamport: number;
  tasks: TaskRow[];
  notes: AppendRow[];
  events: AppendRow[];
  handoffs: AppendRow[];
};

export type MergeResult = {
  tasks: { inserted: number; updated: number; skipped: number; conflicts: number };
  notes: number;
  events: number;
  handoffs: number;
};

const TASK_SELECT = `
  SELECT t.uuid, t.origin, t.lamport, t.public_id,
         p.uuid AS parent_uuid,
         t.title, t.description, t.status, t.priority, t.next_action,
         t.blocked_reason, t.archived_at, t.created_at, t.updated_at
  FROM tasks t
  LEFT JOIN tasks p ON p.id = t.parent_id
`;

/** Everything written locally after the given clock value. */
export function exportChangeset(since = 0): Changeset {
  const db = getDb();
  const origin = localOrigin();

  const tasks = db.prepare(`${TASK_SELECT} WHERE t.lamport > ?`).all(since) as TaskRow[];

  // Everything leaving here is now a version a peer knows about, so later local
  // edits are distinguishable from it.
  const agree = db.prepare(`UPDATE tasks SET synced_lamport = lamport WHERE uuid = ?`);
  for (const task of tasks) agree.run(task.uuid);

  // Row ids are per-database, so the link travels as the task's uuid.
  const append = (table: string, linkColumn: string) =>
    db
      .prepare(
        `SELECT r.*, t.uuid AS task_uuid FROM ${table} r
         LEFT JOIN tasks t ON t.id = r.${linkColumn} WHERE r.lamport > ?`
      )
      .all(since) as AppendRow[];

  const lamports = [
    ...tasks.map((task) => task.lamport),
    origin.lamport
  ];

  return {
    origin: origin.id,
    origin_label: origin.label,
    lamport: Math.max(...lamports, 0),
    tasks,
    notes: append('task_notes', 'task_id'),
    events: append('task_events', 'task_id'),
    handoffs: append('project_handoff', 'current_task_id')
  };
}

/**
 * Two databases that were never paired both believe they are the original, so
 * both mint TASK-001. When an incoming id is already taken by a different task,
 * the arriving one is relabelled into a free local slot.
 *
 * public_id travels as an ordinary field, so the new label propagates back on
 * the next sync and both sides converge on it. The uuid never changes, so
 * nothing that points at the task by identity is affected.
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
function incomingWins(incoming: TaskRow, local: { lamport: number; origin: string }): boolean {
  if (incoming.lamport !== local.lamport) return incoming.lamport > local.lamport;
  return incoming.origin > local.origin;
}

function differs(incoming: TaskRow, local: Record<string, unknown>): boolean {
  const fields = [
    'title',
    'description',
    'status',
    'priority',
    'next_action',
    'blocked_reason',
    'archived_at'
  ] as const;
  return fields.some((field) => (incoming[field] ?? null) !== (local[field] ?? null));
}

export function applyChangeset(changeset: Changeset): MergeResult {
  const db = getDb();
  registerOrigin(changeset.origin, changeset.origin_label);

  const result: MergeResult = {
    tasks: { inserted: 0, updated: 0, skipped: 0, conflicts: 0 },
    notes: 0,
    events: 0,
    handoffs: 0
  };

  const run = db.transaction(() => {
    const localId = localOrigin().id;
    const findTask = db.prepare(`SELECT * FROM tasks WHERE uuid = ?`);

    for (const incoming of changeset.tasks) {
      const local = findTask.get(incoming.uuid) as Record<string, unknown> | undefined;

      if (!local) {
        db.prepare(
          `INSERT INTO tasks (uuid, origin, lamport, synced_lamport, public_id, title, description,
                              status, priority, next_action, blocked_reason, archived_at,
                              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          incoming.uuid,
          incoming.origin,
          incoming.lamport,
          incoming.lamport,
          publicIdFor(incoming),
          incoming.title,
          incoming.description,
          incoming.status,
          incoming.priority,
          incoming.next_action,
          incoming.blocked_reason,
          incoming.archived_at,
          incoming.created_at,
          incoming.updated_at
        );
        result.tasks.inserted++;
        continue;
      }

      if (!incomingWins(incoming, local as { lamport: number; origin: string })) {
        result.tasks.skipped++;
        continue;
      }

      // A conflict is both sides having moved past the version they last
      // agreed on. Creating a task and never touching it again is not an edit,
      // which is why the comparison is against synced_lamport and not origin.
      const changedLocally = (local.lamport as number) > (local.synced_lamport as number);
      const conflicted = changedLocally && differs(incoming, local);

      db.prepare(
        `UPDATE tasks SET origin = ?, lamport = ?, synced_lamport = ?, title = ?, description = ?,
                          status = ?, priority = ?, next_action = ?, blocked_reason = ?,
                          archived_at = ?, updated_at = ?
         WHERE uuid = ?`
      ).run(
        incoming.origin,
        incoming.lamport,
        incoming.lamport,
        incoming.title,
        incoming.description,
        incoming.status,
        incoming.priority,
        incoming.next_action,
        incoming.blocked_reason,
        incoming.archived_at,
        incoming.updated_at,
        incoming.uuid
      );
      result.tasks.updated++;

      if (conflicted) {
        // The losing version goes into the history rather than being dropped.
        db.prepare(
          `INSERT INTO task_events (uuid, origin, lamport, task_id, event_type, summary, payload_json, agent_id)
           VALUES (?, ?, ?, ?, 'SYNC_CONFLICT', ?, ?, 'sync')`
        ).run(
          newUuid(),
          localId,
          nextLamport(),
          local.id as number,
          `${incoming.public_id}: la versión local fue reemplazada por ${changeset.origin_label}`,
          JSON.stringify({ discarded_local: local, applied_remote: incoming })
        );
        result.tasks.conflicts++;
      }
    }

    // Second pass: parents may have arrived in the same changeset, so links are
    // resolved only once every task exists.
    for (const incoming of changeset.tasks) {
      if (!incoming.parent_uuid) continue;
      db.prepare(
        `UPDATE tasks SET parent_id = (SELECT id FROM tasks WHERE uuid = ?) WHERE uuid = ?`
      ).run(incoming.parent_uuid, incoming.uuid);
    }

    result.notes = insertAppendOnly(changeset.notes, 'task_notes', [
      'task_id',
      'body',
      'author_type',
      'created_at'
    ]);
    result.events = insertAppendOnly(changeset.events, 'task_events', [
      'task_id',
      'event_type',
      'summary',
      'payload_json',
      'agent_id',
      'created_at'
    ]);
    result.handoffs = insertAppendOnly(changeset.handoffs, 'project_handoff', [
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
    ]);

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
