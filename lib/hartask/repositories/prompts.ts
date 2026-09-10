import { getDb } from '@/lib/db/client';
import { getTask, recordEvent } from '@/lib/hartask/repositories/tasks';
import { localOrigin, localStamp, nextLamport } from '@/lib/hartask/sync/identity';
import type { Prompt, PromptRun, PromptStatus } from '@/lib/hartask/types';

/**
 * The Prompt Stack: a queue of agent-executable instructions.
 *
 * A prompt is not a task. One task usually needs several prompts, and one
 * prompt can be attempted several times — which is why runs are separate rows
 * rather than fields on the prompt.
 */

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Queue order: highest priority, then the author's ordering, then oldest. */
const QUEUE_ORDER = `ORDER BY priority DESC, position ASC, id ASC`;

export function listPrompts(filter: { status?: PromptStatus[]; taskId?: number } = {}): Prompt[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.status?.length) {
    where.push(`status IN (${filter.status.map(() => '?').join(',')})`);
    params.push(...filter.status);
  }
  if (filter.taskId !== undefined) {
    where.push(`task_id = ?`);
    params.push(filter.taskId);
  }

  return getDb()
    .prepare(
      `SELECT * FROM prompts ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ${QUEUE_ORDER}`
    )
    .all(...params) as Prompt[];
}

export function getPrompt(ref: number | string): Prompt | null {
  const sql =
    typeof ref === 'number'
      ? `SELECT * FROM prompts WHERE id = ?`
      : `SELECT * FROM prompts WHERE uuid = ?`;
  return (getDb().prepare(sql).get(ref) as Prompt | undefined) ?? null;
}

export function listRuns(promptId: number): PromptRun[] {
  return getDb()
    .prepare(`SELECT * FROM prompt_runs WHERE prompt_id = ? ORDER BY id DESC`)
    .all(promptId) as PromptRun[];
}

export function countPromptsByStatus(): Record<string, number> {
  const rows = getDb()
    .prepare(`SELECT status, COUNT(*) AS total FROM prompts GROUP BY status`)
    .all() as { status: string; total: number }[];

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = row.total;
  return counts;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type CreatePromptInput = {
  prompt: string;
  title?: string | null;
  taskId?: number | null;
  status?: PromptStatus;
  priority?: number;
  position?: number;
};

export function createPrompt(input: CreatePromptInput): Prompt {
  const db = getDb();
  const stamp = localStamp();

  const info = db
    .prepare(
      `INSERT INTO prompts (uuid, origin, lamport, task_id, title, prompt, status, priority, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      stamp.uuid,
      stamp.origin,
      stamp.lamport,
      input.taskId ?? null,
      input.title ?? null,
      input.prompt,
      input.status ?? 'DRAFT',
      input.priority ?? 0,
      input.position ?? 0
    );

  return db.prepare(`SELECT * FROM prompts WHERE id = ?`).get(info.lastInsertRowid) as Prompt;
}

export type UpdatePromptInput = {
  title?: string | null;
  prompt?: string;
  status?: PromptStatus;
  priority?: number;
  position?: number;
};

const UPDATABLE: Record<keyof UpdatePromptInput, string> = {
  title: 'title',
  prompt: 'prompt',
  status: 'status',
  priority: 'priority',
  position: 'position'
};

export function updatePrompt(ref: number | string, patch: UpdatePromptInput): Prompt {
  const db = getDb();
  const current = getPrompt(ref);
  if (!current) throw new Error(`Prompt not found: ${ref}`);

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    const value = patch[key as keyof UpdatePromptInput];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (!sets.length) return current;

  sets.push(`updated_at = CURRENT_TIMESTAMP`, `lamport = ?`, `origin = ?`);
  params.push(nextLamport(), localOrigin().id);
  db.prepare(`UPDATE prompts SET ${sets.join(', ')} WHERE id = ?`).run(...params, current.id);

  return db.prepare(`SELECT * FROM prompts WHERE id = ?`).get(current.id) as Prompt;
}

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

export type Claim = { prompt: Prompt; run: PromptRun };

/**
 * Takes the next queued prompt and starts a run for it, atomically.
 *
 * Claim, not get: two agents must never receive the same prompt. The select
 * and the update have to be one indivisible step, so the transaction is
 * IMMEDIATE — a deferred one takes its write lock only at the UPDATE, leaving
 * a window where another connection could read the same row as READY and claim
 * it too.
 *
 * This holds for agents sharing one database. Across synced machines it cannot:
 * two of them claiming while disconnected have both already run the work by the
 * time they meet, which the merge records as SYNC_DOUBLE_CLAIM. See docs/SYNC.md.
 *
 * A claimed prompt is CLAIMED, following the lifecycle in the README. The
 * prompt's RUNNING state is not produced today: the open run row is what says
 * execution is in flight, and duplicating that on the prompt would give two
 * places to keep in agreement.
 */
export function claimNextPrompt(agentId: string): Claim | null {
  const db = getDb();

  const run = db.transaction((): Claim | null => {
    const next = db
      .prepare(`SELECT * FROM prompts WHERE status = 'READY' ${QUEUE_ORDER} LIMIT 1`)
      .get() as Prompt | undefined;
    if (!next) return null;

    db.prepare(
      `UPDATE prompts SET status = 'CLAIMED', claimed_by = ?, claimed_at = CURRENT_TIMESTAMP,
                          updated_at = CURRENT_TIMESTAMP, lamport = ?, origin = ?
       WHERE id = ?`
    ).run(agentId, nextLamport(), localOrigin().id, next.id);

    const stamp = localStamp();
    const info = db
      .prepare(
        `INSERT INTO prompt_runs (uuid, origin, lamport, prompt_id, agent_id, status)
         VALUES (?, ?, ?, ?, ?, 'RUNNING')`
      )
      .run(stamp.uuid, stamp.origin, stamp.lamport, next.id, agentId);

    const prompt = db.prepare(`SELECT * FROM prompts WHERE id = ?`).get(next.id) as Prompt;
    const created = db
      .prepare(`SELECT * FROM prompt_runs WHERE id = ?`)
      .get(info.lastInsertRowid) as PromptRun;

    recordEvent({
      taskId: prompt.task_id,
      eventType: 'PROMPT_CLAIMED',
      summary: `${agentId} tomó un prompt de la cola`,
      payload: { prompt_uuid: prompt.uuid, run_uuid: created.uuid },
      agentId
    });

    return { prompt, run: created };
  });

  return run.immediate();
}

function closeRun(
  promptId: number,
  status: 'DONE' | 'FAILED',
  fields: { summary?: string | null; error?: string | null }
): PromptRun | null {
  const db = getDb();
  const open = db
    .prepare(`SELECT * FROM prompt_runs WHERE prompt_id = ? AND status = 'RUNNING' ORDER BY id DESC LIMIT 1`)
    .get(promptId) as PromptRun | undefined;
  if (!open) return null;

  db.prepare(
    `UPDATE prompt_runs SET status = ?, summary = ?, error = ?, finished_at = CURRENT_TIMESTAMP,
                            lamport = ?, origin = ?
     WHERE id = ?`
  ).run(
    status,
    fields.summary ?? null,
    fields.error ?? null,
    nextLamport(),
    localOrigin().id,
    open.id
  );

  return db.prepare(`SELECT * FROM prompt_runs WHERE id = ?`).get(open.id) as PromptRun;
}

export function completePrompt(ref: number | string, summary?: string | null): Claim {
  const db = getDb();
  const run = db.transaction((): Claim => {
    const prompt = getPrompt(ref);
    if (!prompt) throw new Error(`Prompt not found: ${ref}`);

    const closed = closeRun(prompt.id, 'DONE', { summary });
    const updated = updatePrompt(prompt.id, { status: 'DONE' });

    recordEvent({
      taskId: updated.task_id,
      eventType: 'PROMPT_COMPLETED',
      summary: summary ?? `Prompt completado`,
      payload: { prompt_uuid: updated.uuid, run_uuid: closed?.uuid ?? null },
      agentId: prompt.claimed_by
    });

    return { prompt: updated, run: closed as PromptRun };
  });
  return run();
}

/**
 * A failed run does not end the prompt by default.
 *
 * The queue exists because the same instruction may need several attempts, so
 * failing returns it to READY and leaves the attempt in the run history.
 * Passing `retry: false` gives up on it instead.
 */
export function failPrompt(
  ref: number | string,
  error: string,
  options: { retry?: boolean } = {}
): Claim {
  const db = getDb();
  const retry = options.retry ?? true;

  const run = db.transaction((): Claim => {
    const prompt = getPrompt(ref);
    if (!prompt) throw new Error(`Prompt not found: ${ref}`);

    const closed = closeRun(prompt.id, 'FAILED', { error });
    const updated = updatePrompt(prompt.id, { status: retry ? 'READY' : 'FAILED' });

    recordEvent({
      taskId: updated.task_id,
      eventType: 'PROMPT_FAILED',
      summary: retry ? `Intento fallido, vuelve a la cola: ${error}` : `Prompt abandonado: ${error}`,
      payload: { prompt_uuid: updated.uuid, run_uuid: closed?.uuid ?? null, retry, error },
      agentId: prompt.claimed_by
    });

    return { prompt: updated, run: closed as PromptRun };
  });
  return run();
}

/** Resolves a prompt reference and the task it belongs to, for the UI. */
/**
 * What a cold-start briefing says about the queue.
 *
 * Counts and the next one's name, never the instructions themselves: a
 * briefing that carried every queued prompt would grow with the queue, and the
 * text is only needed by whoever claims it.
 *
 * `next` is the prompt a claim would actually take, because listing and
 * claiming share one queue order — naming it is not a guess about what comes
 * up next.
 */
export function promptQueueBriefing(): {
  counts: Record<string, number>;
  ready: number;
  next: { id: number; title: string | null; task: string | null } | null;
  claim: string;
} {
  const queue = listPrompts({ status: ['READY'] });
  const next = queue[0];

  return {
    counts: countPromptsByStatus(),
    ready: queue.length,
    next: next ? { id: next.id, title: next.title, task: promptTaskLabel(next) } : null,
    claim: 'POST /api/prompts/claim with { agent_id }. Claim it, never read it and run it.'
  };
}

export function promptTaskLabel(prompt: Prompt): string | null {
  if (prompt.task_id === null) return null;
  const task = getTask(prompt.task_id);
  return task ? `${task.public_id} · ${task.title}` : null;
}
