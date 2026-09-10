import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimNextPrompt,
  completePrompt,
  countPromptsByStatus,
  createPrompt,
  failPrompt,
  getPrompt,
  listPrompts,
  listRuns,
  promptQueueBriefing,
  updatePrompt
} from '@/lib/hartask/repositories/prompts';
import { createTask, listEvents } from '@/lib/hartask/repositories/tasks';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('createPrompt', () => {
  it('starts as a draft, so nothing is queued by accident', () => {
    const prompt = createPrompt({ prompt: 'Analyze the current auth' });

    expect(prompt.status).toBe('DRAFT');
    expect(prompt.claimed_by).toBeNull();
    expect(claimNextPrompt('an-agent')).toBeNull();
  });

  it('links to the task it serves', () => {
    const task = createTask({ title: 'Add authentication' });
    const prompt = createPrompt({ prompt: 'Add tests', taskId: task.id, status: 'READY' });

    expect(prompt.task_id).toBe(task.id);
    expect(listPrompts({ taskId: task.id })).toHaveLength(1);
  });
});

describe('queue order', () => {
  it('is highest priority, then the author ordering, then oldest', () => {
    const low = createPrompt({ prompt: 'low', status: 'READY', priority: 1 });
    const high = createPrompt({ prompt: 'high', status: 'READY', priority: 9 });
    const second = createPrompt({ prompt: 'second', status: 'READY', priority: 1, position: 2 });
    const first = createPrompt({ prompt: 'first', status: 'READY', priority: 1, position: 1 });

    expect(listPrompts({ status: ['READY'] }).map((p) => p.id)).toEqual([
      high.id,
      low.id,
      first.id,
      second.id
    ]);
  });
});

describe('claimNextPrompt', () => {
  it('takes the front of the queue and starts a run for it', () => {
    createPrompt({ prompt: 'later', status: 'READY', priority: 1 });
    const urgent = createPrompt({ prompt: 'urgent', status: 'READY', priority: 9 });

    const claim = claimNextPrompt('agent-one')!;

    expect(claim.prompt.id).toBe(urgent.id);
    // The lifecycle in the README: claiming marks it CLAIMED, and the open run
    // row is what says execution is in flight.
    expect(claim.prompt.status).toBe('CLAIMED');
    expect(claim.prompt.claimed_by).toBe('agent-one');
    expect(claim.prompt.claimed_at).not.toBeNull();
    expect(claim.run.status).toBe('RUNNING');
    expect(claim.run.agent_id).toBe('agent-one');
    expect(claim.run.finished_at).toBeNull();
  });

  it('never hands the same prompt to two agents', () => {
    createPrompt({ prompt: 'one', status: 'READY' });
    createPrompt({ prompt: 'two', status: 'READY' });

    const first = claimNextPrompt('agent-one')!;
    const second = claimNextPrompt('agent-two')!;

    // The whole point of claiming rather than getting.
    expect(first.prompt.id).not.toBe(second.prompt.id);
    expect(claimNextPrompt('agent-three')).toBeNull();
  });

  it('only takes what is queued, never a draft or a finished one', () => {
    createPrompt({ prompt: 'draft', status: 'DRAFT' });
    createPrompt({ prompt: 'done', status: 'DONE' });
    createPrompt({ prompt: 'cancelled', status: 'CANCELLED' });

    expect(claimNextPrompt('an-agent')).toBeNull();
  });

  it('records the claim on the task the prompt serves', () => {
    const task = createTask({ title: 'Add authentication' });
    createPrompt({ prompt: 'Add tests', taskId: task.id, status: 'READY' });

    claimNextPrompt('agent-one');

    const event = listEvents({ taskId: task.id }).find((e) => e.event_type === 'PROMPT_CLAIMED');
    expect(event).toBeDefined();
    expect(event?.agent_id).toBe('agent-one');
  });
});

describe('finishing a run', () => {
  it('completing closes the run and the prompt', () => {
    createPrompt({ prompt: 'Do the thing', status: 'READY' });
    const claim = claimNextPrompt('agent-one')!;

    const done = completePrompt(claim.prompt.id, 'Implemented and tested');

    expect(done.prompt.status).toBe('DONE');
    expect(done.run.status).toBe('DONE');
    expect(done.run.summary).toBe('Implemented and tested');
    expect(done.run.finished_at).not.toBeNull();
  });

  it('failing returns the prompt to the queue and keeps the attempt', () => {
    createPrompt({ prompt: 'Fix the tests', status: 'READY' });
    const claim = claimNextPrompt('agent-one')!;

    const failed = failPrompt(claim.prompt.id, 'the mock lacks expires_at');

    // The queue exists because an instruction may need several attempts.
    expect(failed.prompt.status).toBe('READY');
    expect(failed.prompt.status).not.toBe('FAILED');
    expect(failed.run.status).toBe('FAILED');
    expect(failed.run.error).toBe('the mock lacks expires_at');
    expect(claimNextPrompt('agent-two')?.prompt.id).toBe(claim.prompt.id);
  });

  it('gives up on the prompt when the retry is refused', () => {
    createPrompt({ prompt: 'Fix the tests', status: 'READY' });
    const claim = claimNextPrompt('agent-one')!;

    const failed = failPrompt(claim.prompt.id, 'not worth retrying', { retry: false });

    expect(failed.prompt.status).toBe('FAILED');
    expect(claimNextPrompt('agent-two')).toBeNull();
  });

  it('keeps the whole attempt history, which is why runs are rows', () => {
    const prompt = createPrompt({ prompt: 'Fix the auth tests', status: 'READY' });

    claimNextPrompt('agent-one');
    failPrompt(prompt.id, 'first failure');
    claimNextPrompt('agent-one');
    failPrompt(prompt.id, 'second failure');
    claimNextPrompt('agent-one');
    completePrompt(prompt.id, 'finally green');

    const runs = listRuns(prompt.id);
    expect(runs.map((run) => run.status)).toEqual(['DONE', 'FAILED', 'FAILED']);
    expect(getPrompt(prompt.id)?.status).toBe('DONE');
  });
});

describe('updatePrompt', () => {
  it('moves a draft into the queue', () => {
    const prompt = createPrompt({ prompt: 'Analyze the current auth' });
    expect(claimNextPrompt('an-agent')).toBeNull();

    updatePrompt(prompt.id, { status: 'READY' });

    expect(claimNextPrompt('an-agent')?.prompt.id).toBe(prompt.id);
  });

  it('throws for an unknown prompt', () => {
    expect(() => updatePrompt(4242, { status: 'READY' })).toThrow(/not found/i);
  });
});

describe('countPromptsByStatus', () => {
  it('counts the queue by status', () => {
    createPrompt({ prompt: 'a', status: 'READY' });
    createPrompt({ prompt: 'b', status: 'READY' });
    createPrompt({ prompt: 'c', status: 'DRAFT' });
    claimNextPrompt('agent-one');

    expect(countPromptsByStatus()).toEqual({ READY: 1, DRAFT: 1, CLAIMED: 1 });
  });
});


/**
 * What a cold-start briefing says about the queue.
 *
 * This block used to be a hardcoded `{ queue: null, note: 'TODO: prompt stack
 * repository' }` long after the repository existed, so an agent reading the
 * briefing concluded there was no queue to work. The point of these is that the
 * briefing answers from the queue rather than from a sentence someone wrote
 * once.
 */
describe('promptQueueBriefing', () => {
  it('reports an empty queue as empty, not as absent', () => {
    const briefing = promptQueueBriefing();

    expect(briefing.ready).toBe(0);
    expect(briefing.next).toBeNull();
    expect(briefing.counts).toEqual({});
  });

  it('counts what is waiting and names the one a claim would take', () => {
    const task = createTask({ title: 'Add authentication' });
    createPrompt({ prompt: 'segundo', title: 'Segundo', status: 'READY', priority: 0 });
    createPrompt({
      prompt: 'primero',
      title: 'Primero',
      status: 'READY',
      priority: 10,
      taskId: task.id
    });

    const briefing = promptQueueBriefing();

    expect(briefing.ready).toBe(2);
    expect(briefing.next?.title).toBe('Primero');
    expect(briefing.next?.task).toContain(task.public_id);
  });

  // Listing and claiming share one queue order, so what the briefing names has
  // to be what a claim actually hands over.
  it('names the same prompt the claim gives out', () => {
    createPrompt({ prompt: 'segundo', title: 'Segundo', status: 'READY', priority: 0 });
    createPrompt({ prompt: 'primero', title: 'Primero', status: 'READY', priority: 10 });

    const named = promptQueueBriefing().next!;
    const claimed = claimNextPrompt('agent-one')!;

    expect(claimed.prompt.id).toBe(named.id);
  });

  // A briefing is read on every cold start, so it cannot grow with the queue.
  it('never carries the instructions themselves', () => {
    createPrompt({ prompt: 'un texto muy largo que nadie necesita hasta reclamarlo', status: 'READY' });

    expect(JSON.stringify(promptQueueBriefing())).not.toContain('un texto muy largo');
  });

  it('does not offer a draft, because nothing can claim it', () => {
    createPrompt({ prompt: 'todavia no', title: 'Borrador' });

    expect(promptQueueBriefing().ready).toBe(0);
    expect(promptQueueBriefing().counts.DRAFT).toBe(1);
  });

  it('says how to take it, because reading it and running it is the mistake', () => {
    expect(promptQueueBriefing().claim).toMatch(/claim/i);
  });
});
