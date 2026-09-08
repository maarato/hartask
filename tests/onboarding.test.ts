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

  it('tells the agent about syncing, and that it needs its own permission', () => {
    const instructions = onboarding()!.instructions;

    // Without this an agent adopting Hartask never learns the store exists,
    // and the user has to remember on their own.
    expect(instructions).toMatch(/sync/i);
    // Whitespace-tolerant: the source wraps, and the rule is what matters.
    expect(instructions.replace(/\s+/g, ' ')).toMatch(
      /never sync for the first time without asking/i
    );
  });

  it('warns about the setting that would merge two projects into one', () => {
    // Copying an .env.local from another project is how this happens, and the
    // damage is two boards sharing one scope in the store.
    expect(onboarding()!.instructions).toContain('HARTASK_SYNC_PROJECT_ID');
  });

  it('returns nothing once the project is in use', () => {
    createTask({ title: 'a task' });
    expect(onboarding()).toBeNull();
  });
});
