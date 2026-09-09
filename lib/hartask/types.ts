export const TASK_STATUSES = [
  'BACKLOG',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'DONE',
  'CANCELLED'
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Statuses that no longer represent pending work. */
export const CLOSED_STATUSES: TaskStatus[] = ['DONE', 'CANCELLED'];

/**
 * Statuses a task can be archived from. Work in flight is deliberately not
 * archivable: hiding an IN_PROGRESS or BLOCKED task would hide the very thing
 * the board exists to surface.
 */
export const ARCHIVABLE_STATUSES: TaskStatus[] = ['DONE', 'BACKLOG'];

export function isArchivable(status: TaskStatus): boolean {
  return ARCHIVABLE_STATUSES.includes(status);
}

export type Project = {
  id: number;
  uuid: string;
  name: string;
  root_path: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

/** Identity every synced row carries, so a merge can match and order rows. */
export type SyncFields = {
  uuid: string;
  origin: string;
  lamport: number;
};

export type Task = SyncFields & {
  id: number;
  public_id: string;
  parent_id: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  next_action: string | null;
  blocked_reason: string | null;
  /** Free label grouping tasks by area. Null is a first-class value here. */
  category: string | null;
  /** ISO timestamp when the task was archived; null while it is on the board. */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskNode = Task & { children: TaskNode[] };

/**
 * A document agents write for each other: durable, mutable, and narrower than
 * the whole project. Addressed by slug, because the same document on two
 * machines has two row ids and one name.
 */
export type SharedContext = SyncFields & {
  id: number;
  slug: string;
  title: string;
  purpose: string | null;
  body: string | null;
  category: string | null;
  /** Public id of the task this was last known to be true as of. */
  valid_as_of: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * A document without its body. Listings use this so knowing what exists never
 * costs the cost of reading everything — the guard that keeps the collection
 * from becoming write-only.
 */
export type SharedContextSummary = Omit<SharedContext, 'body'>;

export type TaskNote = SyncFields & {
  id: number;
  task_id: number;
  body: string;
  author_type: string;
  created_at: string;
};

export type TaskEvent = SyncFields & {
  id: number;
  task_id: number | null;
  event_type: string;
  summary: string | null;
  payload_json: string | null;
  agent_id: string | null;
  created_at: string;
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

/**
 * One handoff row is one checkpoint. The table is append-only: the current
 * handoff is the most recent row, and older rows stay as history.
 */
export type Handoff = SyncFields & {
  id: number;
  current_task_id: number | null;
  what_was_done: string | null;
  current_state: string | null;
  next_step: string | null;
  known_problems: string | null;
  important_files_json: string | null;
  important_decisions: string | null;
  source: string;
  agent_run_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Handoff with the file list parsed and the referenced task resolved. */
export type HandoffView = Omit<Handoff, 'important_files_json'> & {
  important_files: string[];
  current_task: Task | null;
};

/**
 * Board order: work that can be picked up comes first, closed work last.
 * Kept next to TASK_STATUSES so the ranking has one source of truth, and used
 * by the task repository so the API and the UI agree on the same order.
 */
export const STATUS_ORDER: readonly TaskStatus[] = [
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'REVIEW',
  'BACKLOG',
  'CANCELLED',
  'DONE'
];

export const PROMPT_STATUSES = [
  'DRAFT',
  'READY',
  'CLAIMED',
  'RUNNING',
  'DONE',
  'FAILED',
  'CANCELLED'
] as const;

export type PromptStatus = (typeof PROMPT_STATUSES)[number];

/** Statuses a queued prompt can still be picked up from. */
export const CLAIMABLE_STATUS: PromptStatus = 'READY';

export type Prompt = SyncFields & {
  id: number;
  synced_lamport: number;
  task_id: number | null;
  title: string | null;
  prompt: string;
  status: PromptStatus;
  priority: number;
  position: number;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PromptRunStatus = 'RUNNING' | 'DONE' | 'FAILED';

export type PromptRun = SyncFields & {
  id: number;
  synced_lamport: number;
  prompt_id: number;
  agent_id: string | null;
  status: string;
  summary: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export function isPromptStatus(value: unknown): value is PromptStatus {
  return typeof value === 'string' && (PROMPT_STATUSES as readonly string[]).includes(value);
}
