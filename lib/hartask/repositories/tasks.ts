import { getDb } from '@/lib/db/client';
import { localOrigin, localStamp, nextLamport } from '@/lib/hartask/sync/identity';
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
  /**
   * A category name, or null for the tasks that have none. Undefined means no
   * filter at all — "no category" is a real thing to ask for, so it cannot be
   * the same value as "did not ask".
   */
  category?: string | null;
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

  if (filter.category !== undefined) {
    // Matched case-insensitively so a board that has both "Sync" and "sync"
    // still filters as one thing.
    where.push(filter.category === null ? `category IS NULL` : `category = ? COLLATE NOCASE`);
    if (filter.category !== null) params.push(filter.category);
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
  category?: string | null;
  agentId?: string | null;
};

/**
 * Categories are free text, so the same area can arrive spelled two ways.
 * Whitespace is trimmed and an empty string becomes null — a task with a
 * category of "" is not a category, it is a task without one. When the board
 * already knows this name under a different case, that existing spelling wins,
 * which keeps "Sync" and "sync" from becoming two columns in the filter.
 */
export function normalizeCategory(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return value ?? null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;

  const existing = getDb()
    .prepare(`SELECT category FROM tasks WHERE category = ? COLLATE NOCASE LIMIT 1`)
    .get(trimmed) as { category: string } | undefined;

  return existing?.category ?? trimmed;
}

/**
 * The category a new task starts with.
 *
 * A subtask under a categorised parent takes the parent's, because a subtask
 * that is born blank drops out of its own area's filter and nobody notices:
 * the parent shows up decapitated, without the children, which is where the
 * work actually is.
 *
 * Saying nothing and saying "none" are different answers, so they are kept
 * apart here — undefined inherits, an explicit null does not. It is the same
 * rule ListTasksFilter.category already uses, and collapsing the two is what
 * would remove the only way to put a subtask deliberately outside its parent's
 * area.
 *
 * The parent's value is copied, not derived on read: the stored row is then
 * what the board, the API and the store all agree on, and a later change to
 * the parent leaves the child's own decision alone.
 */
function categoryForNewTask(data: CreateTaskInput): string | null {
  if (data.category !== undefined) return normalizeCategory(data.category);
  if (data.parentId === undefined || data.parentId === null) return null;
  return getTask(data.parentId)?.category ?? null;
}

/** Categories in use, with how many live tasks carry each, for the board filter. */
export function listCategories(): { name: string; count: number }[] {
  return getDb()
    .prepare(
      `SELECT category AS name, COUNT(*) AS count FROM tasks
       WHERE category IS NOT NULL AND archived_at IS NULL
       GROUP BY category COLLATE NOCASE
       ORDER BY name COLLATE NOCASE ASC`
    )
    .all() as { name: string; count: number }[];
}

/** How many live tasks carry no category, so the filter can offer that too. */
export function countUncategorized(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS total FROM tasks WHERE category IS NULL AND archived_at IS NULL`)
    .get() as { total: number };
  return row.total;
}

/**
 * Ids are minted per origin. Each origin only ever scans its own prefix, so
 * two of them creating a task at the same time cannot produce the same id —
 * and the origin that created the database keeps the bare TASK-001 format, so
 * existing references stay valid.
 */
function nextPublicId(): string {
  const prefix = localOrigin().public_id_prefix;
  const head = `TASK-${prefix}`;

  const row = getDb()
    .prepare(
      `SELECT public_id FROM tasks
       WHERE public_id GLOB ?
       ORDER BY CAST(SUBSTR(public_id, ?) AS INTEGER) DESC
       LIMIT 1`
    )
    .get(`${head}[0-9]*`, head.length + 1) as { public_id: string } | undefined;

  const next = row ? Number.parseInt(row.public_id.slice(head.length), 10) + 1 : 1;
  return `${head}${String(next).padStart(3, '0')}`;
}

export function createTask(input: CreateTaskInput): Task {
  const db = getDb();

  // public_id generation reads the current max, so allocation and insert must
  // share one transaction to stay correct with two agents writing at once.
  const run = db.transaction((data: CreateTaskInput): Task => {
    const stamp = localStamp();
    const info = db
      .prepare(
        `INSERT INTO tasks (uuid, origin, lamport, public_id, parent_id, title, description, status, priority, next_action, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stamp.uuid,
        stamp.origin,
        stamp.lamport,
        nextPublicId(),
        data.parentId ?? null,
        data.title,
        data.description ?? null,
        data.status ?? 'BACKLOG',
        data.priority ?? 0,
        data.nextAction ?? null,
        categoryForNewTask(data)
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
  category?: string | null;
  agentId?: string | null;
};

const UPDATABLE_COLUMNS: Record<keyof Omit<UpdateTaskInput, 'agentId'>, string> = {
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  nextAction: 'next_action',
  blockedReason: 'blocked_reason',
  parentId: 'parent_id',
  category: 'category'
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
      params.push(key === 'category' ? normalizeCategory(value as string | null) : value);
    }

    if (sets.length) {
      // A local edit moves the row's clock forward, which is what a merge
      // compares to decide whether this version or the remote one is newer.
      sets.push(`updated_at = CURRENT_TIMESTAMP`, `lamport = ?`, `origin = ?`);
      params.push(nextLamport(), localOrigin().id);
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
  const stamp = localStamp();
  const info = db
    .prepare(
      `INSERT INTO task_notes (uuid, origin, lamport, task_id, body, author_type)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(stamp.uuid, stamp.origin, stamp.lamport, taskId, body, authorType);
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
  const stamp = localStamp();
  const info = db
    .prepare(
      `INSERT INTO task_events (uuid, origin, lamport, task_id, event_type, summary, payload_json, agent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      stamp.uuid,
      stamp.origin,
      stamp.lamport,
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
       SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
           lamport = ?, origin = ?
       WHERE id = ? OR parent_id = ?`
    ).run(nextLamport(), localOrigin().id, task.id, task.id);

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
       SET archived_at = NULL, updated_at = CURRENT_TIMESTAMP,
           lamport = ?, origin = ?
       WHERE id = ? OR parent_id = ?`
    ).run(nextLamport(), localOrigin().id, task.id, task.id);

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

/**
 * Root tasks currently eligible for archiving, used by the board reminder.
 *
 * `statuses` narrows the set. DONE and BACKLOG are archivable for different
 * reasons — one is finished, the other was never started — so archiving them
 * is not always the same decision, and the caller says which it means.
 */
export function listArchivableRoots(statuses: TaskStatus[] = ARCHIVABLE_STATUSES): Task[] {
  // An empty selection means nothing was chosen, never "everything": the SQL
  // below would otherwise be `IN ()`, and a bulk archive is the wrong place to
  // guess.
  if (!statuses.length) return [];
  const eligible = statuses.filter((status) => isArchivable(status));
  if (!eligible.length) return [];

  return getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE parent_id IS NULL
         AND archived_at IS NULL
         AND status IN (${eligible.map(() => '?').join(',')})
       ORDER BY ${STATUS_RANK_SQL}, priority DESC, id ASC`
    )
    .all(...eligible) as Task[];
}

/** How many archivable roots sit in each status, so a chooser can say so. */
export function countArchivableRootsByStatus(): Record<TaskStatus, number> {
  const counts = Object.fromEntries(
    ARCHIVABLE_STATUSES.map((status) => [status, 0])
  ) as Record<TaskStatus, number>;

  for (const task of listArchivableRoots()) counts[task.status] += 1;
  return counts;
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
export function archiveAllArchivable(
  agentId?: string | null,
  statuses: TaskStatus[] = ARCHIVABLE_STATUSES
): Task[] {
  const db = getDb();
  const run = db.transaction((): Task[] =>
    listArchivableRoots(statuses).map((task) => archiveTask(task.id, agentId))
  );
  return run();
}
