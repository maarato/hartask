import { beforeEach, describe, expect, it } from 'vitest';
import {
  archiveAllArchivable,
  archiveTask,
  countArchivableRoots,
  countArchivableRootsByStatus,
  countTasksByStatus,
  countUncategorized,
  listCategories,
  createTask,
  getCurrentTask,
  getTask,
  getTaskByRef,
  listEvents,
  listTasks,
  listTaskTree,
  normalizeCategory,
  setTaskStatus,
  unarchiveTask,
  updateTask
} from '@/lib/hartask/repositories/tasks';
import { resetDb } from './helpers';

beforeEach(() => resetDb());

describe('createTask', () => {
  it('generates sequential public ids', () => {
    expect(createTask({ title: 'first' }).public_id).toBe('TASK-001');
    expect(createTask({ title: 'second' }).public_id).toBe('TASK-002');
    expect(createTask({ title: 'third' }).public_id).toBe('TASK-003');
  });

  it('continues numbering from the highest existing id, not the row count', () => {
    createTask({ title: 'first' });
    const second = createTask({ title: 'second' });
    setTaskStatus(second.public_id, 'CANCELLED');

    // A gap in the middle must not cause a collision with an existing id.
    expect(createTask({ title: 'third' }).public_id).toBe('TASK-003');
  });

  it('defaults to BACKLOG and records a TASK_CREATED event', () => {
    const task = createTask({ title: 'a task' });

    expect(task.status).toBe('BACKLOG');
    expect(task.archived_at).toBeNull();

    const events = listEvents({ taskId: task.id });
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('TASK_CREATED');
  });
});

describe('getTaskByRef', () => {
  it('accepts a public id and a numeric row id from the same path segment', () => {
    const task = createTask({ title: 'a task' });

    expect(getTaskByRef('TASK-001')?.id).toBe(task.id);
    expect(getTaskByRef(String(task.id))?.id).toBe(task.id);
  });

  it('returns null for an unknown reference instead of throwing', () => {
    expect(getTaskByRef('TASK-999')).toBeNull();
    expect(getTaskByRef('4242')).toBeNull();
    expect(getTaskByRef('not-an-id')).toBeNull();
  });
});

describe('updateTask', () => {
  it('records an event for a status transition', () => {
    const task = createTask({ title: 'a task', status: 'READY' });
    updateTask(task.public_id, { status: 'IN_PROGRESS' });

    const events = listEvents({ taskId: task.id });
    expect(events[0].event_type).toBe('TASK_STATUS_CHANGED');
    expect(JSON.parse(events[0].payload_json ?? '{}')).toEqual({
      from: 'READY',
      to: 'IN_PROGRESS'
    });
  });

  it('does not record an event when the status is unchanged', () => {
    const task = createTask({ title: 'a task', status: 'READY' });
    updateTask(task.public_id, { title: 'renamed', status: 'READY' });

    const events = listEvents({ taskId: task.id });
    expect(events.map((event) => event.event_type)).toEqual(['TASK_CREATED']);
    expect(getTask(task.id)?.title).toBe('renamed');
  });

  it('clears the blocked reason when leaving BLOCKED', () => {
    const task = createTask({ title: 'a task' });
    setTaskStatus(task.public_id, 'BLOCKED', { blockedReason: 'waiting on review' });
    expect(getTask(task.id)?.blocked_reason).toBe('waiting on review');

    setTaskStatus(task.public_id, 'READY');
    expect(getTask(task.id)?.blocked_reason).toBeNull();
  });

  it('throws for an unknown task', () => {
    expect(() => updateTask('TASK-999', { status: 'DONE' })).toThrow(/not found/i);
  });
});

describe('ordering', () => {
  it('puts actionable work first and closed work last', () => {
    createTask({ title: 'done', status: 'DONE' });
    createTask({ title: 'backlog', status: 'BACKLOG' });
    createTask({ title: 'ready', status: 'READY' });
    createTask({ title: 'blocked', status: 'BLOCKED' });

    expect(listTasks().map((task) => task.status)).toEqual([
      'READY',
      'BLOCKED',
      'BACKLOG',
      'DONE'
    ]);
  });

  it('breaks ties by priority, then by creation order', () => {
    const low = createTask({ title: 'low', status: 'BACKLOG', priority: 1 });
    const high = createTask({ title: 'high', status: 'BACKLOG', priority: 9 });
    const alsoLow = createTask({ title: 'also low', status: 'BACKLOG', priority: 1 });

    expect(listTasks().map((task) => task.id)).toEqual([high.id, low.id, alsoLow.id]);
  });
});

describe('listTaskTree', () => {
  it('nests children under their parent', () => {
    const parent = createTask({ title: 'parent' });
    const child = createTask({ title: 'child', parentId: parent.id });

    const tree = listTaskTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(parent.id);
    expect(tree[0].children.map((node) => node.id)).toEqual([child.id]);
  });

  it('promotes a child to root level when its parent is filtered out', () => {
    const parent = createTask({ title: 'parent', status: 'DONE' });
    const child = createTask({ title: 'child', status: 'READY', parentId: parent.id });

    // Filtering must never make a task disappear from the view entirely.
    const tree = listTaskTree({ status: ['READY'] });
    expect(tree.map((node) => node.id)).toEqual([child.id]);
  });
});

describe('getCurrentTask', () => {
  it('prefers work in progress over work that is merely ready', () => {
    createTask({ title: 'ready', status: 'READY', priority: 99 });
    const started = createTask({ title: 'started', status: 'IN_PROGRESS', priority: 1 });

    expect(getCurrentTask()?.id).toBe(started.id);
  });

  it('returns null when nothing is actionable', () => {
    createTask({ title: 'done', status: 'DONE' });
    expect(getCurrentTask()).toBeNull();
  });
});

describe('archiving', () => {
  it('archives a root task together with its subtasks', () => {
    const parent = createTask({ title: 'parent', status: 'DONE' });
    const child = createTask({ title: 'child', status: 'READY', parentId: parent.id });

    archiveTask(parent.public_id);

    expect(getTask(parent.id)?.archived_at).not.toBeNull();
    expect(getTask(child.id)?.archived_at).not.toBeNull();
  });

  it('refuses to archive a subtask on its own', () => {
    const parent = createTask({ title: 'parent', status: 'DONE' });
    const child = createTask({ title: 'child', status: 'DONE', parentId: parent.id });

    expect(() => archiveTask(child.public_id)).toThrow(/subtask/i);
    expect(getTask(child.id)?.archived_at).toBeNull();
  });

  it('refuses to archive work that is still in flight', () => {
    for (const status of ['READY', 'IN_PROGRESS', 'BLOCKED', 'REVIEW'] as const) {
      const task = createTask({ title: status, status });
      expect(() => archiveTask(task.public_id)).toThrow(/only DONE and BACKLOG/i);
    }
  });

  it('hides archived tasks from the board, the counts and the current task', () => {
    const done = createTask({ title: 'done', status: 'DONE' });
    createTask({ title: 'ready', status: 'READY' });
    archiveTask(done.public_id);

    expect(listTasks().map((task) => task.id)).not.toContain(done.id);
    expect(countTasksByStatus().DONE).toBeUndefined();
    expect(getCurrentTask()?.status).toBe('READY');
  });

  it('still finds archived tasks when they are asked for', () => {
    const task = createTask({ title: 'done', status: 'DONE' });
    archiveTask(task.public_id);

    expect(listTasks({ includeArchived: true }).map((t) => t.id)).toContain(task.id);
    expect(listTasks({ onlyArchived: true }).map((t) => t.id)).toEqual([task.id]);
  });

  it('restores a branch and records both events', () => {
    const parent = createTask({ title: 'parent', status: 'BACKLOG' });
    const child = createTask({ title: 'child', parentId: parent.id });

    archiveTask(parent.public_id);
    unarchiveTask(parent.public_id);

    expect(getTask(parent.id)?.archived_at).toBeNull();
    expect(getTask(child.id)?.archived_at).toBeNull();
    expect(listEvents({ taskId: parent.id }).map((event) => event.event_type)).toEqual([
      'TASK_UNARCHIVED',
      'TASK_ARCHIVED',
      'TASK_CREATED'
    ]);
  });
});

describe('archiveAllArchivable', () => {
  it('counts only root tasks that are eligible', () => {
    const parent = createTask({ title: 'done parent', status: 'DONE' });
    createTask({ title: 'done child', status: 'DONE', parentId: parent.id });
    createTask({ title: 'backlog', status: 'BACKLOG' });
    createTask({ title: 'ready', status: 'READY' });

    expect(countArchivableRoots()).toBe(2);
  });

  it('archives every eligible root and leaves the rest alone', () => {
    createTask({ title: 'done', status: 'DONE' });
    createTask({ title: 'backlog', status: 'BACKLOG' });
    const ready = createTask({ title: 'ready', status: 'READY' });

    const archived = archiveAllArchivable('test-agent');

    expect(archived).toHaveLength(2);
    expect(countArchivableRoots()).toBe(0);
    expect(listTasks().map((task) => task.id)).toEqual([ready.id]);
  });

  it('records one event per archived task, not one for the batch', () => {
    createTask({ title: 'done', status: 'DONE' });
    createTask({ title: 'backlog', status: 'BACKLOG' });

    archiveAllArchivable();

    const archivedEvents = listEvents({ limit: 50 }).filter(
      (event) => event.event_type === 'TASK_ARCHIVED'
    );
    expect(archivedEvents).toHaveLength(2);
  });

  it('archives only the statuses it was asked for', () => {
    createTask({ title: 'done', status: 'DONE' });
    const backlog = createTask({ title: 'backlog', status: 'BACKLOG' });

    const archived = archiveAllArchivable(null, ['DONE']);

    expect(archived.map((task) => task.status)).toEqual(['DONE']);
    expect(listTasks().map((task) => task.id)).toEqual([backlog.id]);
  });

  // The failure that would actually cost work: an empty selection is nothing
  // chosen, and must never be read as everything.
  it('archives nothing when no status was chosen', () => {
    createTask({ title: 'done', status: 'DONE' });
    createTask({ title: 'backlog', status: 'BACKLOG' });

    expect(archiveAllArchivable(null, [])).toHaveLength(0);
    expect(countArchivableRoots()).toBe(2);
  });

  it('ignores a status that is not archivable in the first place', () => {
    createTask({ title: 'ready', status: 'READY' });

    expect(archiveAllArchivable(null, ['READY'])).toHaveLength(0);
    expect(listTasks()).toHaveLength(1);
  });
});

describe('countArchivableRootsByStatus', () => {
  it('breaks the count down so the chooser can say what it would archive', () => {
    createTask({ title: 'done one', status: 'DONE' });
    createTask({ title: 'done two', status: 'DONE' });
    createTask({ title: 'backlog', status: 'BACKLOG' });
    createTask({ title: 'ready', status: 'READY' });

    expect(countArchivableRootsByStatus()).toEqual({ DONE: 2, BACKLOG: 1 });
  });

  it('reports zero rather than omitting a status with nothing in it', () => {
    createTask({ title: 'done', status: 'DONE' });

    expect(countArchivableRootsByStatus()).toEqual({ DONE: 1, BACKLOG: 0 });
  });
});


describe('categories', () => {
  it('leaves a task without one, because a category is optional', () => {
    expect(createTask({ title: 'no category' }).category).toBeNull();
  });

  it('stores the one it was given', () => {
    expect(createTask({ title: 'sync work', category: 'sync' }).category).toBe('sync');
  });

  it('treats a blank category as no category rather than as an empty one', () => {
    expect(createTask({ title: 'blank', category: '   ' }).category).toBeNull();
  });

  it('trims and collapses whitespace instead of storing it', () => {
    expect(createTask({ title: 'padded', category: '  data   layer ' }).category).toBe('data layer');
  });

  // Otherwise a board slowly grows "Sync", "sync" and "SYNC" as three areas.
  it('reuses the spelling already on the board when only the case differs', () => {
    createTask({ title: 'first', category: 'Sync' });

    expect(createTask({ title: 'second', category: 'sync' }).category).toBe('Sync');
    expect(listCategories()).toHaveLength(1);
  });

  it('takes a task out of its category when the field is cleared', () => {
    const task = createTask({ title: 'categorised', category: 'ui' });

    expect(updateTask(task.id, { category: null }).category).toBeNull();
  });

  it('leaves the category alone when the patch does not mention it', () => {
    const task = createTask({ title: 'categorised', category: 'ui' });

    expect(updateTask(task.id, { title: 'renamed' }).category).toBe('ui');
  });

  it('normalises on update as well as on create', () => {
    const task = createTask({ title: 'a' });
    createTask({ title: 'b', category: 'Harness' });

    expect(updateTask(task.id, { category: ' harness ' }).category).toBe('Harness');
  });

  it('filters the board to one area, matching case-insensitively', () => {
    createTask({ title: 'one', category: 'Sync' });
    createTask({ title: 'two', category: 'ui' });

    expect(listTasks({ category: 'sync' }).map((task) => task.title)).toEqual(['one']);
  });

  it('can ask for the tasks that have no category at all', () => {
    createTask({ title: 'plain' });
    createTask({ title: 'labelled', category: 'ui' });

    expect(listTasks({ category: null }).map((task) => task.title)).toEqual(['plain']);
  });

  // undefined is "did not ask"; null is a real question with a real answer.
  it('does not filter when no category was asked for', () => {
    createTask({ title: 'plain' });
    createTask({ title: 'labelled', category: 'ui' });

    expect(listTasks()).toHaveLength(2);
  });

  it('counts what is in use for the filter, ignoring archived tasks', () => {
    createTask({ title: 'one', category: 'sync' });
    createTask({ title: 'two', category: 'sync' });
    const gone = createTask({ title: 'three', category: 'ui', status: 'DONE' });
    createTask({ title: 'plain' });
    archiveTask(gone.id);

    expect(listCategories()).toEqual([{ name: 'sync', count: 2 }]);
    expect(countUncategorized()).toBe(1);
  });

  it('normalizeCategory passes a missing value through untouched', () => {
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
  });
});
