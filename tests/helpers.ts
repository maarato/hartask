import { getDb } from '@/lib/db/client';
import { localOrigin, localStamp, nextLamport } from '@/lib/hartask/sync/identity';

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
    DELETE FROM tasks;
    DELETE FROM projects;
    DELETE FROM sqlite_sequence;
  `);
}

/**
 * Prompt Stack has no repository yet (TASK-017), so these stand in for it:
 * enough to exercise the sync path, stamping identity the way a repository
 * would. Replace them with the real repository once it exists.
 */
export function insertPrompt(input: {
  prompt: string;
  taskId?: number | null;
  status?: string;
  claimedBy?: string | null;
}): { id: number; uuid: string } {
  const db = getDb();
  const stamp = localStamp();
  const info = db
    .prepare(
      `INSERT INTO prompts (uuid, origin, lamport, task_id, prompt, status, claimed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      stamp.uuid,
      stamp.origin,
      stamp.lamport,
      input.taskId ?? null,
      input.prompt,
      input.status ?? 'READY',
      input.claimedBy ?? null
    );
  return { id: Number(info.lastInsertRowid), uuid: stamp.uuid };
}

/** Claiming a prompt: a local edit, so it moves the row's clock forward. */
export function claimPrompt(uuid: string, agent: string): void {
  getDb()
    .prepare(
      `UPDATE prompts SET status = 'CLAIMED', claimed_by = ?, claimed_at = CURRENT_TIMESTAMP,
                          updated_at = CURRENT_TIMESTAMP, lamport = ?, origin = ?
       WHERE uuid = ?`
    )
    .run(agent, nextLamport(), localOrigin().id, uuid);
}

export function insertPromptRun(promptId: number, status: string): { uuid: string } {
  const db = getDb();
  const stamp = localStamp();
  db.prepare(
    `INSERT INTO prompt_runs (uuid, origin, lamport, prompt_id, agent_id, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(stamp.uuid, stamp.origin, stamp.lamport, promptId, 'test-agent', status);
  return { uuid: stamp.uuid };
}

export function listPrompts(): Record<string, unknown>[] {
  return getDb().prepare(`SELECT * FROM prompts ORDER BY id`).all() as Record<string, unknown>[];
}

export function listPromptRuns(): Record<string, unknown>[] {
  return getDb().prepare(`SELECT * FROM prompt_runs ORDER BY id`).all() as Record<string, unknown>[];
}
