import { getDb } from '@/lib/db/client';
import {
  ARCHIVABLE_STATUSES,
  CLOSED_STATUSES,
  isArchivable,
  STATUS_ORDER,
  type Task,
  type TaskEvent,
  type TaskNode,
  type TaskNote,
  type TaskStatus
} from '@/lib/hartask/types';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Ranks rows by STATUS_ORDER so actionable work floats and closed work sinks.
 * Interpolation is safe here: the values come from a typed constant, never
 * from a request.
 */
const STATUS_RANK_SQL = `CASE status ${STATUS_ORDER.map(
  (status, index) => `WHEN '${status}' THEN ${index}`
).join(' ')} ELSE ${STATUS_ORDER.length} END`;

export type ListTasksFilter = {
  status?: TaskStatus[];
  parentId?: number | null;
  includeClosed?: boolean;
  /** Archived tasks are off the board unless explicitly asked for. */
  includeArchived?: boolean;
  onlyArchived?: boolean;
};

/** Flat list, ordered by STATUS_ORDER, then priority, then oldest first. */
export function listTasks(filter: ListTasksFilter = {}): Task[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.status?.length) {
    where.push(`status IN (${filter.status.map(() => '?').join(',')})`);
    params.push(...filter.status);
  } else if (filter.includeClosed === false) {
    where.push(`status NOT IN (${CLOSED_STATUSES.map(() => '?').join(',')})`);
    params.push(...CLOSED_STATUSES);
  }

  if (filter.parentId !== undefined) {
    where.push(filter.parentId === null ? `parent_id IS NULL` : `parent_id = ?`);
    if (filter.parentId !== null) params.push(filter.parentId);
  }

  if (filter.onlyArchived) where.push(`archived_at IS NOT NULL`);
  else if (!filter.includeArchived) where.push(`archived_at IS NULL`);

  const sql = `
    SELECT * FROM tasks
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${STATUS_RANK_SQL}, priority DESC, id ASC
  `;

  return getDb().prepare(sql).all(...params) as Task[];
}

/** Same rows as listTasks, rebuilt into the parent_id hierarchy the UI renders. */
export function listTaskTree(filter: ListTasksFilter = {}): TaskNode[] {
  const tasks = listTasks(filter);
  const byId = new Map<number, TaskNode>(tasks.map((t) => [t.id, { ...t, children: [] }]));
  const roots: TaskNode[] = [];

  for (const node of byId.values()) {
    const parent = node.parent_id === null ? undefined : byId.get(node.parent_id);
    // A task whose parent was filtered out is rendered at root level rather
    // than silently disappearing from the view.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

export function getTask(ref: number | string): Task | null {
  const sql =
    typeof ref === 'number'
      ? `SELECT * FROM tasks WHERE id = ?`
      : `SELECT * FROM tasks WHERE public_id = ?`;
  return (getDb().prepare(sql).get(ref) as Task | undefined) ?? null;
}

/**
 * Resolves a path segment that may be either a public id (TASK-001) or a row
 * id, so the API route and the detail page accept the same references.
 */
export function getTaskByRef(ref: string): Task | null {
  return getTask(/^\d+$/.test(ref) ? Number(ref) : ref);
}

/** Counts the active board only; archived tasks are not pending work. */
export function countTasksByStatus(): Record<TaskStatus, number> {
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) AS total FROM tasks WHERE archived_at IS NULL GROUP BY status`
    )
    .all() as { status: TaskStatus; total: number }[];

  const counts = {} as Record<TaskStatus, number>;
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}

/** The task a session should resume: in progress first, then ready work. */
export function getCurrentTask(): Task | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE status IN ('IN_PROGRESS','READY') AND archived_at IS NULL
       ORDER BY CASE status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END, priority DESC, id ASC
       LIMIT 1`
    )
    .get();
  return (row as Task | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  parentId?: number | null;
  priority?: number;
  nextAction?: string | null;
  agentId?: string | null;
};

function nextPublicId(): string {
  const row = getDb()
    .prepare(
      `SELECT public_id FROM tasks
       WHERE public_id GLOB 'TASK-[0-9]*'
       ORDER BY CAST(SUBSTR(public_id, 6) AS INTEGER) DESC
       LIMIT 1`
    )
    .get() as { public_id: string } | undefined;

  const next = row ? Number.parseInt(row.public_id.slice(5), 10) + 1 : 1;
  return `TASK-${String(next).padStart(3, '0')}`;
}

export function createTask(input: CreateTaskInput): Task {
  const db = getDb();

  // public_id generation reads the current max, so allocation and insert must
  // share one transaction to stay correct with two agents writing at once.
  const run = db.transaction((data: CreateTaskInput): Task => {
    const info = db
      .prepare(
        `INSERT INTO tasks (public_id, parent_id, title, description, status, priority, next_action)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nextPublicId(),
        data.parentId ?? null,
        data.title,
        data.description ?? null,
        data.status ?? 'BACKLOG',
        data.priority ?? 0,
        data.nextAction ?? null
      );

    const task = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(info.lastInsertRowid) as Task;

    recordEvent({
      taskId: task.id,
      eventType: 'TASK_CREATED',
      summary: `${task.public_id} created as ${task.status}`,
      agentId: data.agentId ?? null
    });

    return task;
  });

  return run(input);
}

export type UpdateTaskInput = {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: number;
  nextAction?: string | null;
  blockedReason?: string | null;
  parentId?: number | null;
  agentId?: string | null;
};

const UPDATABLE_COLUMNS: Record<keyof Omit<UpdateTaskInput, 'agentId'>, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  nextAction: 'next_action',
  blockedReason: 'blocked_reason',
  parentId: 'parent_id'
};

export function updateTask(ref: number | string, patch: UpdateTaskInput): Task {
  const db = getDb();

  const run = db.transaction((): Task => {
    const current = getTask(ref);
    if (!current) throw new Error(`Task not found: ${ref}`);

    const sets: string[] = [];
    const params: unknown[] = [];

    for (const [key, column] of Object.entries(UPDATABLE_COLUMNS)) {
      const value = patch[key as keyof typeof UPDATABLE_COLUMNS];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }

    if (sets.length) {
      sets.push(`updated_at = CURRENT_TIMESTAMP`);
      db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params, current.id);
    }

    const updated = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(current.id) as Task;

    // Only a status transition is a meaningful event; renaming a task is not.
    if (patch.status && patch.status !== current.status) {
      recordEvent({
        taskId: updated.id,
        eventType: 'TASK_STATUS_CHANGED',
        summary: `${updated.public_id}: ${current.status} -> ${updated.status}`,
        payload: { from: current.status, to: updated.status },
        agentId: patch.agentId ?? null
      });
    }

    return updated;
  });

  return run();
}

/** Convenience wrapper used by the UI status control and by agent tooling. */
export function setTaskStatus(
  ref: number | string,
  status: TaskStatus,
  options: { blockedReason?: string | null; agentId?: string | null } = {}
): Task {
  return updateTask(ref, {
    status,
    blockedReason: status === 'BLOCKED' ? options.blockedReason ?? null : null,
    agentId: options.agentId ?? null
  });
}

// ---------------------------------------------------------------------------
// Notes and events
// ---------------------------------------------------------------------------

export function listNotes(taskId: number): TaskNote[] {
  return getDb()
    .prepare(`SELECT * FROM task_notes WHERE task_id = ? ORDER BY id DESC`)
    .all(taskId) as TaskNote[];
}

export function addNote(
  taskId: number,
  body: string,
  authorType: 'agent' | 'human' = 'agent'
): TaskNote {
  const db = getDb();
  const info = db
    .prepare(`INSERT INTO task_notes (task_id, body, author_type) VALUES (?, ?, ?)`)
    .run(taskId, body, authorType);
  return db.prepare(`SELECT * FROM task_notes WHERE id = ?`).get(info.lastInsertRowid) as TaskNote;
}

export type RecordEventInput = {
  taskId?: number | null;
  eventType: string;
  summary?: string | null;
  payload?: unknown;
  agentId?: string | null;
};

export function recordEvent(input: RecordEventInput): TaskEvent {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO task_events (task_id, event_type, summary, payload_json, agent_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      input.taskId ?? null,
      input.eventType,
      input.summary ?? null,
      input.payload === undefined ? null : JSON.stringify(input.payload),
      input.agentId ?? null
    );

  return db.prepare(`SELECT * FROM task_events WHERE id = ?`).get(info.lastInsertRowid) as TaskEvent;
}

export function listEvents(options: { taskId?: number; limit?: number } = {}): TaskEvent[] {
  const limit = options.limit ?? 50;
  if (options.taskId === undefined) {
    return getDb()
      .prepare(`SELECT * FROM task_events ORDER BY id DESC LIMIT ?`)
      .all(limit) as TaskEvent[];
  }
  return getDb()
    .prepare(`SELECT * FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT ?`)
    .all(options.taskId, limit) as TaskEvent[];
}

// ---------------------------------------------------------------------------
// Archiving
// ---------------------------------------------------------------------------

/**
 * Archiving hides a task from the board without deleting it or losing its
 * status, so a saturated board can be cleared while the history stays intact.
 *
 * Only root tasks can be archived, and archiving one takes its subtasks with
 * it: leaving children behind would promote them to root level in
 * listTaskTree(), which is the opposite of what archiving is for.
 */
export function archiveTask(ref: number | string, agentId?: string | null): Task {
  const db = getDb();

  const run = db.transaction((): Task => {
    const task = getTask(ref);
    if (!task) throw new Error(`Task not found: ${ref}`);
    if (task.parent_id !== null) {
      throw new Error(`${task.public_id} is a subtask; archive its parent instead`);
    }
    if (!isArchivable(task.status)) {
      throw new Error(
        `${task.public_id} is ${task.status}; only ${ARCHIVABLE_STATUSES.join(' and ')} can be archived`
      );
    }

    db.prepare(
      `UPDATE tasks
       SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? OR parent_id = ?`
    ).run(task.id, task.id);

    const archived = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(task.id) as Task;

    recordEvent({
      taskId: archived.id,
      eventType: 'TASK_ARCHIVED',
      summary: `${archived.public_id} archived from ${archived.status}`,
      agentId: agentId ?? null
    });

    return archived;
  });

  return run();
}

/** Puts an archived task, and its subtasks, back on the board. */
export function unarchiveTask(ref: number | string, agentId?: string | null): Task {
  const db = getDb();

  const run = db.transaction((): Task => {
    const task = getTask(ref);
    if (!task) throw new Error(`Task not found: ${ref}`);

    db.prepare(
      `UPDATE tasks
       SET archived_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? OR parent_id = ?`
    ).run(task.id, task.id);

    const restored = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(task.id) as Task;

    recordEvent({
      taskId: restored.id,
      eventType: 'TASK_UNARCHIVED',
      summary: `${restored.public_id} restored to the board`,
      agentId: agentId ?? null
    });

    return restored;
  });

  return run();
}

/** Root tasks currently eligible for archiving, used by the board reminder. */
export function listArchivableRoots(): Task[] {
  return getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE parent_id IS NULL
         AND archived_at IS NULL
         AND status IN (${ARCHIVABLE_STATUSES.map(() => '?').join(',')})
       ORDER BY ${STATUS_RANK_SQL}, priority DESC, id ASC`
    )
    .all(...ARCHIVABLE_STATUSES) as Task[];
}

export function countArchivableRoots(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS total FROM tasks
       WHERE parent_id IS NULL
         AND archived_at IS NULL
         AND status IN (${ARCHIVABLE_STATUSES.map(() => '?').join(',')})`
    )
    .get(...ARCHIVABLE_STATUSES) as { total: number };
  return row.total;
}

/**
 * Archives every eligible root task in one transaction, reusing archiveTask so
 * the rules and the per-task events stay identical to archiving one by one.
 * Per-task events are kept on purpose: each task really was archived, and a
 * single bulk event would leave those tasks with no record of it.
 */
export function archiveAllArchivable(agentId?: string | null): Task[] {
  const db = getDb();
  const run = db.transaction((): Task[] =>
    listArchivableRoots().map((task) => archiveTask(task.id, agentId))
  );
  return run();
}
