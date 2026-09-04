import { getDb } from '@/lib/db/client';
import { getTask, recordEvent } from '@/lib/hartask/repositories/tasks';
import type { Handoff, HandoffView } from '@/lib/hartask/types';

/**
 * The handoff answers "where did we leave off". Rows are never updated in
 * place: each checkpoint is appended, so the project keeps a readable trail of
 * how its state was understood over time, and the current handoff is simply
 * the latest row.
 */

function parseFiles(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : [];
  } catch {
    // A malformed row must not break the cold-start view.
    return [];
  }
}

function toView(row: Handoff): HandoffView {
  const { important_files_json, ...rest } = row;
  return {
    ...rest,
    important_files: parseFiles(important_files_json),
    current_task: row.current_task_id === null ? null : getTask(row.current_task_id)
  };
}

export function getLatestHandoff(): HandoffView | null {
  const row = getDb().prepare(`SELECT * FROM project_handoff ORDER BY id DESC LIMIT 1`).get();
  return row ? toView(row as Handoff) : null;
}

export function listHandoffs(limit = 20): HandoffView[] {
  const rows = getDb()
    .prepare(`SELECT * FROM project_handoff ORDER BY id DESC LIMIT ?`)
    .all(limit) as Handoff[];
  return rows.map(toView);
}

export type CreateHandoffInput = {
  /** Numeric id or public id (TASK-001). Unknown references are stored as null. */
  currentTask?: number | string | null;
  whatWasDone?: string | null;
  currentState?: string | null;
  nextStep?: string | null;
  knownProblems?: string | string[] | null;
  importantFiles?: string[] | null;
  importantDecisions?: string | null;
  source?: string;
  agentRunId?: string | null;
};

function normalizeProblems(value: string | string[] | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  // The documented payload sends a list; the column is plain text on purpose,
  // because problems are read, not queried.
  const text = Array.isArray(value) ? value.filter(Boolean).join('\n') : value;
  return text.trim() ? text : null;
}

export function createHandoff(input: CreateHandoffInput): HandoffView {
  const db = getDb();

  const task =
    input.currentTask === null || input.currentTask === undefined
      ? null
      : getTask(input.currentTask);

  const info = db
    .prepare(
      `INSERT INTO project_handoff (
         current_task_id, what_was_done, current_state, next_step,
         known_problems, important_files_json, important_decisions,
         source, agent_run_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      task?.id ?? null,
      input.whatWasDone ?? null,
      input.currentState ?? null,
      input.nextStep ?? null,
      normalizeProblems(input.knownProblems),
      input.importantFiles?.length ? JSON.stringify(input.importantFiles) : null,
      input.importantDecisions ?? null,
      input.source ?? 'agent-generated',
      input.agentRunId ?? null
    );

  const row = db
    .prepare(`SELECT * FROM project_handoff WHERE id = ?`)
    .get(info.lastInsertRowid) as Handoff;

  // A checkpoint is a meaningful event by definition: it is what the agent
  // considered worth recording about the current state.
  recordEvent({
    taskId: task?.id ?? null,
    eventType: 'HANDOFF_UPDATED',
    summary: input.nextStep ? `Next: ${input.nextStep}` : 'Handoff checkpoint recorded',
    agentId: input.agentRunId ?? null
  });

  return toView(row);
}
