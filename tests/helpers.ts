import { getDb } from '@/lib/db/client';
import { claimNextPrompt, createPrompt, failPrompt } from '@/lib/hartask/repositories/prompts';
import type { PromptStatus } from '@/lib/hartask/types';

/**
 * Empties every table between tests so each one starts from a known board.
 * AUTOINCREMENT counters are reset too, which is what makes assertions on
 * generated public ids (TASK-001) meaningful.
 */
export function resetDb(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM task_events;
    DELETE FROM task_notes;
    DELETE FROM prompt_runs;
    DELETE FROM prompts;
    DELETE FROM project_handoff;
    DELETE FROM harness_components;
    DELETE FROM harness_scans;
    DELETE FROM tasks;
    DELETE FROM projects;
    DELETE FROM sqlite_sequence;
  `);
}

/**
 * Thin wrappers over the prompt repository, so a sync test can set up a queue
 * without repeating its API. Claiming goes through the real claimNextPrompt:
 * these tests only ever have one queued prompt, so it takes that one.
 */
export function insertPrompt(input: {
  prompt: string;
  taskId?: number | null;
  status?: string;
}): { id: number; uuid: string } {
  const created = createPrompt({
    prompt: input.prompt,
    taskId: input.taskId ?? null,
    status: (input.status as PromptStatus | undefined) ?? 'READY'
  });
  return { id: created.id, uuid: created.uuid };
}

/** Claims whatever is queued, which in these tests is the given prompt. */
export function claimPrompt(_uuid: string, agent: string): void {
  claimNextPrompt(agent);
}

export function failLastRun(promptId: number, error: string): void {
  failPrompt(promptId, error);
}

export function listPrompts(): Record<string, unknown>[] {
  return getDb().prepare(`SELECT * FROM prompts ORDER BY id`).all() as Record<string, unknown>[];
}

export function listPromptRuns(): Record<string, unknown>[] {
  return getDb().prepare(`SELECT * FROM prompt_runs ORDER BY id`).all() as Record<string, unknown>[];
}
