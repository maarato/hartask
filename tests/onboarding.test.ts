import { beforeEach, describe, expect, it } from 'vitest';
import { createHandoff } from '@/lib/hartask/repositories/handoff';
import { archiveTask, createTask } from '@/lib/hartask/repositories/tasks';
import { isFirstRun, onboarding } from '@/lib/hartask/onboarding';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('isFirstRun', () => {
  it('is true on a project that has never been used', () => {
    expect(isFirstRun()).toBe(true);
  });

  it('is false once a task exists', () => {
    createTask({ title: 'a task' });
    expect(isFirstRun()).toBe(false);
  });

  it('is false once a handoff exists, even with no tasks', () => {
    createHandoff({ nextStep: 'something' });
    expect(isFirstRun()).toBe(false);
  });

  it('stays false when the board was filled and then archived clean', () => {
    const task = createTask({ title: 'a task', status: 'DONE' });
    archiveTask(task.public_id);

    // Archiving hides tasks from the board, but this project has been used;
    // telling that agent to migrate a task file would be wrong.
    expect(isFirstRun()).toBe(false);
  });
});

describe('onboarding', () => {
  it('returns instructions that require asking the user first', () => {
    const result = onboarding();

    expect(result?.first_run).toBe(true);
    expect(result?.instructions).toMatch(/ask the user/i);
    expect(result?.instructions).toContain('docs/FIRST-RUN.md');
  });

  it('returns nothing once the project is in use', () => {
    createTask({ title: 'a task' });
    expect(onboarding()).toBeNull();
  });
});
