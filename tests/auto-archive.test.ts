import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@/lib/hartask/config';
import { autoArchiveIfEnabled } from '@/lib/hartask/auto-archive';
import {
  countArchivableRoots,
  createTask,
  getTask,
  listEvents,
  listTasks,
  unarchiveTask
} from '@/lib/hartask/repositories/tasks';
import { resetDb } from './helpers';

function configure(options: { auto?: boolean; threshold?: number }) {
  if (options.auto === undefined) delete process.env.HARTASK_AUTO_ARCHIVE;
  else process.env.HARTASK_AUTO_ARCHIVE = String(options.auto);

  if (options.threshold === undefined) delete process.env.HARTASK_ARCHIVE_REMINDER_THRESHOLD;
  else process.env.HARTASK_ARCHIVE_REMINDER_THRESHOLD = String(options.threshold);

  resetConfigCache();
}

/** n archivable root tasks. */
function fill(n: number) {
  for (let i = 0; i < n; i++) createTask({ title: `task ${i}`, status: 'BACKLOG' });
}

beforeEach(() => {
  resetDb();
  configure({ threshold: 3 });
});

afterEach(() => configure({}));

describe('autoArchiveIfEnabled', () => {
  it('does nothing while it is switched off', () => {
    configure({ auto: false, threshold: 3 });
    fill(5);

    expect(autoArchiveIfEnabled()).toHaveLength(0);
    expect(countArchivableRoots()).toBe(5);
  });

  it('is off by default: a board never empties itself unasked', () => {
    configure({ threshold: 3 });
    fill(5);

    expect(autoArchiveIfEnabled()).toHaveLength(0);
  });

  it('does nothing at or below the threshold', () => {
    configure({ auto: true, threshold: 3 });
    fill(3);

    expect(autoArchiveIfEnabled()).toHaveLength(0);
    expect(countArchivableRoots()).toBe(3);
  });

  it('clears the board once the count passes the threshold', () => {
    configure({ auto: true, threshold: 3 });
    fill(4);

    const archived = autoArchiveIfEnabled();

    expect(archived).toHaveLength(4);
    expect(countArchivableRoots()).toBe(0);
    expect(listTasks()).toHaveLength(0);
    expect(listTasks({ onlyArchived: true })).toHaveLength(4);
  });

  it('leaves work in flight alone', () => {
    configure({ auto: true, threshold: 1 });
    fill(3);
    const ready = createTask({ title: 'ready', status: 'READY' });
    const started = createTask({ title: 'started', status: 'IN_PROGRESS' });

    autoArchiveIfEnabled();

    expect(listTasks().map((task) => task.id).sort()).toEqual([ready.id, started.id].sort());
  });

  it('attributes the archiving to auto-archive, not to a person', () => {
    configure({ auto: true, threshold: 1 });
    fill(2);

    autoArchiveIfEnabled();

    const events = listEvents({ limit: 20 }).filter((e) => e.event_type === 'TASK_ARCHIVED');
    expect(events).toHaveLength(2);
    // Without this a board emptying itself is indistinguishable from someone
    // having done it by hand.
    expect(events.every((event) => event.agent_id === 'auto-archive')).toBe(true);
  });

  it('does not undo a restore', () => {
    configure({ auto: true, threshold: 1 });
    fill(3);
    autoArchiveIfEnabled();

    const restored = listTasks({ onlyArchived: true })[0];
    unarchiveTask(restored.public_id);

    // The count is over the threshold again, but the user just asked for this
    // task back. Only mutations that raise the count on their own re-trigger,
    // and restoring is not one of them.
    expect(getTask(restored.id)?.archived_at).toBeNull();
    expect(listTasks().map((task) => task.id)).toContain(restored.id);
  });
});
