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
  name: string;
  root_path: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: number;
  public_id: string;
  parent_id: number | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  next_action: string | null;
  blocked_reason: string | null;
  /** ISO timestamp when the task was archived; null while it is on the board. */
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskNode = Task & { children: TaskNode[] };

export type TaskNote = {
  id: number;
  task_id: number;
  body: string;
  author_type: string;
  created_at: string;
};

export type TaskEvent = {
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
export type Handoff = {
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
