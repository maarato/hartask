import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { createHandoff, getLatestHandoff, listHandoffs } from '@/lib/hartask/repositories/handoff';
import { createTask, listEvents } from '@/lib/hartask/repositories/tasks';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('createHandoff', () => {
  it('appends checkpoints instead of overwriting, newest first', () => {
    createHandoff({ nextStep: 'first' });
    createHandoff({ nextStep: 'second' });

    expect(getLatestHandoff()?.next_step).toBe('second');
    expect(listHandoffs().map((entry) => entry.next_step)).toEqual(['second', 'first']);
  });

  it('resolves the referenced task', () => {
    const task = createTask({ title: 'a task' });
    const handoff = createHandoff({ currentTask: task.public_id, nextStep: 'keep going' });

    expect(handoff.current_task?.public_id).toBe(task.public_id);
    expect(handoff.current_task_id).toBe(task.id);
  });

  it('stores an unknown task reference as no task rather than failing', () => {
    const handoff = createHandoff({ currentTask: 'TASK-999', nextStep: 'keep going' });

    expect(handoff.current_task_id).toBeNull();
    expect(handoff.current_task).toBeNull();
  });

  it('joins a list of problems into readable text', () => {
    const handoff = createHandoff({ knownProblems: ['first problem', 'second problem'] });

    expect(handoff.known_problems).toBe('first problem\nsecond problem');
  });

  it('treats an empty problem list as no problems', () => {
    expect(createHandoff({ knownProblems: [], nextStep: 'x' }).known_problems).toBeNull();
    expect(createHandoff({ knownProblems: '   ', nextStep: 'x' }).known_problems).toBeNull();
  });

  it('round-trips the important files list', () => {
    const files = ['lib/a.ts', 'app/b.tsx'];
    expect(createHandoff({ importantFiles: files }).important_files).toEqual(files);
    expect(createHandoff({ nextStep: 'x' }).important_files).toEqual([]);
  });

  it('records a HANDOFF_UPDATED event against the referenced task', () => {
    const task = createTask({ title: 'a task' });
    createHandoff({ currentTask: task.id, nextStep: 'finish the thing' });

    const events = listEvents({ taskId: task.id });
    expect(events[0].event_type).toBe('HANDOFF_UPDATED');
    expect(events[0].summary).toContain('finish the thing');
  });

  it('defaults the source to agent-generated', () => {
    expect(createHandoff({ nextStep: 'x' }).source).toBe('agent-generated');
    expect(createHandoff({ nextStep: 'x', source: 'human-edited' }).source).toBe('human-edited');
  });
});

describe('getLatestHandoff', () => {
  it('returns null on an empty project', () => {
    expect(getLatestHandoff()).toBeNull();
  });

  it('degrades to an empty file list when the stored JSON is malformed', () => {
    createHandoff({ importantFiles: ['lib/a.ts'], nextStep: 'x' });
    // A corrupted row must not break the cold-start view.
    getDb().prepare(`UPDATE project_handoff SET important_files_json = 'not json'`).run();

    expect(getLatestHandoff()?.important_files).toEqual([]);
  });
});
