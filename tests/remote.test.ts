import { createClient } from '@libsql/client';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@/lib/hartask/config';
import { createHandoff } from '@/lib/hartask/repositories/handoff';
import {
  addNote,
  createTask,
  getTask,
  listEvents,
  listTasks,
  listTaskTree,
  setTaskStatus
} from '@/lib/hartask/repositories/tasks';
import { getContext, writeContext } from '@/lib/hartask/repositories/contexts';
import { isRemoteStoreUrl, syncWithRemoteStore } from '@/lib/hartask/sync/remote';
import { createPeer, on, type Peer } from './peers';
import { claimPrompt, failLastRun, insertPrompt, listPrompts } from './helpers';

/**
 * The libSQL client treats a file: URL exactly like a remote one, so the whole
 * adapter is exercised here without a Turso instance. Only the URL differs.
 */
let store: string;
let laptop: Peer;
let desktop: Peer;

/**
 * One machine syncing against the shared store. `projectId` is how a second
 * machine says which project in the store it is joining.
 */
async function sync(peer: Peer, projectId?: string, options?: { adoptProject?: boolean }) {
  process.env.HARTASK_SYNC_URL = `file:${store}`;
  delete process.env.HARTASK_SYNC_TOKEN;
  if (projectId) process.env.HARTASK_SYNC_PROJECT_ID = projectId;
  else delete process.env.HARTASK_SYNC_PROJECT_ID;
  resetConfigCache();
  return on(peer, () => syncWithRemoteStore(options));
}

async function readStore(table: string) {
  const client = createClient({ url: `file:${store}` });
  try {
    return (await client.execute(`SELECT * FROM ${table}`)).rows as unknown as Record<
      string,
      unknown
    >[];
  } finally {
    client.close();
  }
}

beforeEach(() => {
  store = join(mkdtempSync(join(tmpdir(), 'hartask-store-')), 'store.sqlite');
  laptop = createPeer('laptop-store');
  desktop = createPeer('desktop-store');
});

afterEach(() => {
  delete process.env.HARTASK_SYNC_URL;
  delete process.env.HARTASK_SYNC_TOKEN;
  delete process.env.HARTASK_SYNC_PROJECT_ID;
  resetConfigCache();
});

describe('isRemoteStoreUrl', () => {
  it('tells a passive store from another Hartask instance', () => {
    expect(isRemoteStoreUrl('libsql://db.turso.io')).toBe(true);
    expect(isRemoteStoreUrl('file:/tmp/store.sqlite')).toBe(true);
    expect(isRemoteStoreUrl('https://hartask.example.com')).toBe(false);
  });
});

describe('syncWithRemoteStore', () => {
  it('creates the schema and uploads the board on the first run', async () => {
    on(laptop, () => createTask({ title: 'Implementar OAuth', status: 'READY' }));

    const outcome = await sync(laptop);

    expect(outcome.pulled.tasks.inserted).toBe(0);
    const tasks = await readStore('tasks');
    expect(tasks.map((task) => task.title)).toEqual(['Implementar OAuth']);
    expect(tasks[0].project_uuid).toBe(outcome.project_uuid);
  });

  it('carries the board to a second machine through the store', async () => {
    on(laptop, () => createTask({ title: 'Implementar OAuth', status: 'READY' }));
    const { project_uuid } = await sync(laptop);

    await sync(desktop, project_uuid);

    const arrived = on(desktop, () => listTasks());
    expect(arrived.map((task) => task.title)).toEqual(['Implementar OAuth']);
  });

  it('brings a change made on the other machine back', async () => {
    const task = on(laptop, () => createTask({ title: 'a task', status: 'BACKLOG' }));
    const { project_uuid } = await sync(laptop);
    await sync(desktop, project_uuid);

    on(desktop, () => setTaskStatus(task.public_id, 'READY'));
    await sync(desktop, project_uuid);
    await sync(laptop);

    expect(on(laptop, () => getTask(task.public_id))?.status).toBe('READY');
  });

  it('is idempotent: syncing twice changes nothing', async () => {
    on(laptop, () => createTask({ title: 'a task' }));
    await sync(laptop);
    await sync(laptop);

    expect((await readStore('tasks')).length).toBe(1);
    expect(on(laptop, () => listTasks()).length).toBe(1);
  });

  it('rebuilds the hierarchy through the store, where row ids mean nothing', async () => {
    on(laptop, () => createTask({ title: 'something first' }));
    const { project_uuid } = await sync(laptop);

    // The desktop joins while empty, then does work of its own, which offsets
    // its row ids from the laptop's. The hierarchy that arrives afterwards can
    // only be rebuilt from uuids.
    await sync(desktop, project_uuid);
    on(desktop, () => createTask({ title: 'local work, shifting the ids' }));

    on(laptop, () => {
      const parent = createTask({ title: 'parent' });
      createTask({ title: 'child', parentId: parent.id });
    });
    await sync(laptop);
    await sync(desktop, project_uuid);

    const tree = on(desktop, () => listTaskTree());
    const parent = tree.find((node) => node.title === 'parent');
    expect(parent?.children.map((child) => child.title)).toEqual(['child']);
  });

  it('carries notes and handoffs without duplicating them', async () => {
    on(laptop, () => {
      const task = createTask({ title: 'a task' });
      addNote(task.id, 'from the laptop');
      createHandoff({ currentTask: task.public_id, nextStep: 'keep going' });
    });

    await sync(laptop);
    await sync(laptop);

    expect((await readStore('task_notes')).length).toBe(1);
    expect((await readStore('project_handoff')).length).toBe(1);
  });

  it('keeps one project separate from another in the same store', async () => {
    on(laptop, () => createTask({ title: 'laptop project work' }));
    await sync(laptop);

    // A second, unrelated project pointed at the same store.
    const other = createPeer('other-project');
    on(other, () => createTask({ title: 'other project work' }));
    await sync(other);

    const projects = await readStore('projects');
    expect(projects.length).toBe(2);

    // Neither project sees the other's tasks, which is what project_uuid is for.
    await sync(laptop);
    expect(on(laptop, () => listTasks()).map((t) => t.title)).toEqual(['laptop project work']);
  });

  /**
   * The store adapter used to keep its own list of columns to push, separate
   * from the changeset spec. When a column was added to one and not the other
   * the push still succeeded and the value simply never arrived, which is the
   * kind of bug that only shows up as a blank field weeks later.
   */
  it('puts every column the changeset carries into the store', async () => {
    on(laptop, () => createTask({ title: 'Wire the store', category: 'sync' }));

    const { project_uuid } = await sync(laptop);

    expect((await readStore('tasks'))[0].category).toBe('sync');

    await sync(desktop, project_uuid);
    expect(on(desktop, () => listTasks())[0].category).toBe('sync');
  });

  it('puts a shared context in the store, body and all', async () => {
    on(laptop, () =>
      writeContext({ slug: 'sync-merge', title: 'Merge', purpose: 'Por que Lamport', body: '# uno' })
    );

    const { project_uuid } = await sync(laptop);

    // Read the row back rather than trusting that the push reported success.
    const stored = (await readStore('shared_contexts'))[0];
    expect(stored.slug).toBe('sync-merge');
    expect(stored.body).toBe('# uno');

    await sync(desktop, project_uuid);
    expect(on(desktop, () => getContext('sync-merge'))!.body).toBe('# uno');
  });

  /**
   * Both machines have adopted the same project, so both derive the same uuid
   * from the slug. Without that the store would hold two rows for one document
   * and every machine would keep pulling the loser back.
   */
  it('keeps one row when two adopted machines write the same name', async () => {
    on(laptop, () => createTask({ title: 'algo de trabajo' }));
    const { project_uuid } = await sync(laptop);
    // The desktop adopts the project and pulls: no documents exist yet, so
    // what follows is each machine creating one, not one copying the other.
    await sync(desktop, project_uuid);

    on(laptop, () => writeContext({ slug: 'decisions', title: 'Decisiones', body: 'del laptop' }));
    on(desktop, () => writeContext({ slug: 'decisions', title: 'Decisiones', body: 'del desktop' }));

    await sync(laptop);
    await sync(desktop, project_uuid);

    expect((await readStore('shared_contexts')).length).toBe(1);
  });

  it('carries the prompt queue and its runs through the store', async () => {
    const { project_uuid } = await (async () => {
      on(laptop, () => {
        const task = createTask({ title: 'Add authentication' });
        const prompt = insertPrompt({ prompt: 'Analyze the current auth', taskId: task.id });
        claimPrompt(prompt.uuid, 'agent-on-the-laptop');
        failLastRun(prompt.id, 'the mock lacks expires_at');
      });
      return sync(laptop);
    })();

    expect((await readStore('prompts')).length).toBe(1);
    expect((await readStore('prompt_runs')).length).toBe(1);

    await sync(desktop, project_uuid);

    const arrived = on(desktop, () => listPrompts())[0];
    expect(arrived.prompt).toBe('Analyze the current auth');
    // The link is rebuilt from the uuid: row ids differ on the other side.
    expect(arrived.task_id).toBe(on(desktop, () => listTasks())[0].id);
  });

  it('brings a claim made on the other machine back', async () => {
    const prompt = on(laptop, () => insertPrompt({ prompt: 'Do the thing' }));
    const { project_uuid } = await sync(laptop);
    await sync(desktop, project_uuid);

    on(desktop, () => claimPrompt(prompt.uuid, 'agent-on-the-desktop'));
    await sync(desktop, project_uuid);
    await sync(laptop);

    const local = on(laptop, () => listPrompts())[0];
    expect(local.status).toBe('CLAIMED');
    expect(local.claimed_by).toBe('agent-on-the-desktop');
  });

  it('refuses to fold a board that has its own work into another project', async () => {
    on(laptop, () => createTask({ title: 'the laptop project' }));
    const { project_uuid } = await sync(laptop);

    // A .env.local copied from the laptop, onto a project that already has work.
    on(desktop, () => createTask({ title: 'a different project entirely' }));

    await expect(sync(desktop, project_uuid)).rejects.toThrow(/merge two boards/i);

    // Nothing moved: the store still holds only the laptop's board.
    expect((await readStore('tasks')).map((t) => t.title)).toEqual(['the laptop project']);
    expect(on(desktop, () => listTasks()).map((t) => t.title)).toEqual([
      'a different project entirely'
    ]);
  });

  it('records the refusal instead of failing quietly', async () => {
    on(laptop, () => createTask({ title: 'the laptop project' }));
    const { project_uuid } = await sync(laptop);
    on(desktop, () => createTask({ title: 'a different project entirely' }));

    await sync(desktop, project_uuid).catch(() => undefined);

    const refusal = on(desktop, () =>
      listEvents({ limit: 20 }).find((event) => event.event_type === 'SYNC_REFUSED')
    );
    expect(refusal).toBeDefined();
  });

  it('still lets a genuinely empty machine join', async () => {
    on(laptop, () => createTask({ title: 'existing work' }));
    const { project_uuid } = await sync(laptop);

    // The legitimate case: a fresh install, so there is no board to merge.
    await sync(desktop, project_uuid);

    expect(on(desktop, () => listTasks()).map((t) => t.title)).toEqual(['existing work']);
  });

  it('goes ahead when the move is asked for explicitly', async () => {
    on(laptop, () => createTask({ title: 'the laptop project' }));
    const { project_uuid } = await sync(laptop);
    on(desktop, () => createTask({ title: 'moved on purpose' }));

    // The escape hatch is a parameter of the call, so it cannot ride along
    // inside a copied .env.local the way a setting would.
    await sync(desktop, project_uuid, { adoptProject: true });

    expect((await readStore('tasks')).map((t) => t.title).sort()).toEqual([
      'moved on purpose',
      'the laptop project'
    ]);
  });

  it('records the sync as an event on the project timeline', async () => {
    on(laptop, () => createTask({ title: 'a task' }));
    // The event is written after the push, so it travels on the next sync —
    // recording it earlier would claim success before the write happened.
    await sync(laptop);
    await sync(laptop);

    const events = await readStore('task_events');
    expect(events.some((event) => event.event_type === 'SYNC_COMPLETED')).toBe(true);
  });

  it('joins an existing project when told which one it is', async () => {
    on(laptop, () => createTask({ title: 'existing work' }));
    const { project_uuid } = await sync(laptop);

    // Without the project id the second machine syncs an empty scope of its
    // own and sees nothing, which is the failure this setting exists to avoid.
    await sync(desktop);
    expect(on(desktop, () => listTasks())).toHaveLength(0);

    await sync(desktop, project_uuid);
    expect(on(desktop, () => listTasks()).map((t) => t.title)).toEqual(['existing work']);
  });
});
