import { beforeEach, describe, expect, it } from 'vitest';
import { createHandoff, getLatestHandoff } from '@/lib/hartask/repositories/handoff';
import {
  addNote,
  createTask,
  getTask,
  listEvents,
  listNotes,
  listTasks,
  listTaskTree,
  setTaskStatus,
  updateTask
} from '@/lib/hartask/repositories/tasks';
import { getDb } from '@/lib/db/client';
import { updatePrompt } from '@/lib/hartask/repositories/prompts';
import { getContext, writeContext } from '@/lib/hartask/repositories/contexts';
import { applyChangeset, exportChangeset } from '@/lib/hartask/sync/changeset';
import { localOrigin } from '@/lib/hartask/sync/identity';
import { createPeer, on, type Peer } from './peers';
import {
  claimPrompt,
  insertPrompt,
  failLastRun,
  listPromptRuns,
  listPrompts
} from './helpers';

let laptop: Peer;
let cloud: Peer;

/** Pushes everything one peer has into the other. */
function sync(from: Peer, to: Peer) {
  const changeset = on(from, () => exportChangeset(0));
  return on(to, () => applyChangeset(changeset));
}

beforeEach(() => {
  laptop = createPeer('laptop');
  cloud = createPeer('cloud');
  // Touching each database creates it and its local origin.
  on(laptop, () => localOrigin());
  on(cloud, () => localOrigin());
});

describe('propagation', () => {
  it('carries a task to the other side keeping its identity', () => {
    const created = on(laptop, () => createTask({ title: 'Add authentication', status: 'READY' }));

    const result = sync(laptop, cloud);
    expect(result.tasks.inserted).toBe(1);

    const arrived = on(cloud, () => getTask(created.public_id));
    expect(arrived?.uuid).toBe(created.uuid);
    expect(arrived?.title).toBe('Add authentication');
    expect(arrived?.status).toBe('READY');
  });

  it('exports rows the migration left at clock zero', () => {
    const task = on(laptop, () => createTask({ title: 'a task' }));
    // What the identity backfill produced for every task a project already had
    // before sync existed. An exclusive lower bound would skip all of them.
    on(laptop, () => getDb().prepare(`UPDATE tasks SET lamport = 0`).run());

    const changeset = on(laptop, () => exportChangeset(0));
    expect(changeset.tasks.map((t) => t.uuid)).toEqual([task.uuid]);

    on(cloud, () => applyChangeset(changeset));
    expect(on(cloud, () => listTasks()).map((t) => t.title)).toEqual(['a task']);
  });

  it('is idempotent: applying the same changeset twice changes nothing', () => {
    on(laptop, () => createTask({ title: 'a task' }));
    const changeset = on(laptop, () => exportChangeset(0));

    on(cloud, () => applyChangeset(changeset));
    const second = on(cloud, () => applyChangeset(changeset));

    expect(second.tasks.inserted).toBe(0);
    expect(second.events).toBe(0);
    expect(on(cloud, () => listTasks()).length).toBe(1);
  });

  it('rebuilds the hierarchy from uuids, not row ids', () => {
    on(laptop, () => {
      const parent = createTask({ title: 'parent' });
      createTask({ title: 'child', parentId: parent.id });
    });

    // The cloud already has a task, so its row ids differ from the laptop's.
    on(cloud, () => createTask({ title: 'unrelated local work' }));
    sync(laptop, cloud);

    const tree = on(cloud, () => listTaskTree());
    const parent = tree.find((node) => node.title === 'parent');
    expect(parent?.children.map((child) => child.title)).toEqual(['child']);
  });

  it('sends a change back the other way', () => {
    const task = on(laptop, () => createTask({ title: 'a task', status: 'BACKLOG' }));
    sync(laptop, cloud);

    on(cloud, () => setTaskStatus(task.public_id, 'READY'));
    sync(cloud, laptop);

    expect(on(laptop, () => getTask(task.public_id))?.status).toBe('READY');
  });

  it('merges notes and handoffs as a union, without duplicating them', () => {
    const task = on(laptop, () => {
      const created = createTask({ title: 'a task' });
      addNote(created.id, 'from the laptop');
      createHandoff({ currentTask: created.public_id, nextStep: 'keep going' });
      return created;
    });

    sync(laptop, cloud);
    sync(laptop, cloud);

    const notes = on(cloud, () => listNotes(getTask(task.public_id)!.id));
    expect(notes.map((note) => note.body)).toEqual(['from the laptop']);
    expect(on(cloud, () => getLatestHandoff())?.next_step).toBe('keep going');
    expect(on(cloud, () => getLatestHandoff())?.current_task?.public_id).toBe(task.public_id);
  });
});

describe('prompt stack', () => {
  // A column that is not listed in the changeset syncs as silence: the push
  // succeeds and the value simply never arrives.
  it('carries the category across', () => {
    const task = on(laptop, () => createTask({ title: 'Wire the store', category: 'sync' }));

    sync(laptop, cloud);

    expect(on(cloud, () => getTask(task.public_id))!.category).toBe('sync');
  });

  it('carries a category being cleared, not just one being set', () => {
    const task = on(laptop, () => createTask({ title: 'Wire the store', category: 'sync' }));
    sync(laptop, cloud);

    on(laptop, () => updateTask(task.id, { category: null }));
    sync(laptop, cloud);

    expect(on(cloud, () => getTask(task.public_id))!.category).toBeNull();
  });

  it('carries a prompt and keeps its link to the task', () => {
    const task = on(laptop, () => createTask({ title: 'Add authentication' }));
    on(laptop, () => insertPrompt({ prompt: 'Analyze the current auth', taskId: task.id }));

    const result = sync(laptop, cloud);

    expect(result.prompts.inserted).toBe(1);
    const arrived = on(cloud, () => listPrompts())[0];
    expect(arrived.prompt).toBe('Analyze the current auth');
    // Row ids differ per database, so the link has to be rebuilt from the uuid.
    expect(arrived.task_id).toBe(on(cloud, () => getTask(task.public_id))!.id);
  });

  it('carries a run and keeps its link to the prompt', () => {
    const prompt = on(laptop, () => insertPrompt({ prompt: 'Fix the tests' }));
    // A run only exists because something claimed the prompt and it failed.
    on(laptop, () => {
      claimPrompt(prompt.uuid, 'agent-on-the-laptop');
      failLastRun(prompt.id, 'the mock lacks expires_at');
    });

    sync(laptop, cloud);

    const run = on(cloud, () => listPromptRuns())[0];
    const remotePrompt = on(cloud, () => listPrompts())[0];
    expect(run.status).toBe('FAILED');
    expect(run.prompt_id).toBe(remotePrompt.id);
  });

  it('propagates a claim to the other side', () => {
    const prompt = on(laptop, () => insertPrompt({ prompt: 'Do the thing' }));
    sync(laptop, cloud);

    on(cloud, () => claimPrompt(prompt.uuid, 'agent-in-the-cloud'));
    sync(cloud, laptop);

    const local = on(laptop, () => listPrompts())[0];
    expect(local.status).toBe('CLAIMED');
    expect(local.claimed_by).toBe('agent-in-the-cloud');
  });

  it('records a double claim rather than smoothing it over', () => {
    const prompt = on(laptop, () => insertPrompt({ prompt: 'Do the thing' }));
    sync(laptop, cloud);

    // Both sides claim while disconnected. Sync cannot undo two agents having
    // already run the same work; the least it can do is say so.
    on(laptop, () => claimPrompt(prompt.uuid, 'agent-on-the-laptop'));
    on(cloud, () => {
      claimPrompt(prompt.uuid, 'agent-in-the-cloud');
      // Two more edits put the cloud's clock strictly ahead, so the winner is
      // decided by the clock rather than by the origin tiebreak.
      updatePrompt(prompt.id, { title: 'working on it' });
      updatePrompt(prompt.id, { title: 'still working on it' });
    });

    const result = sync(cloud, laptop);

    expect(result.prompts.conflicts).toBe(1);
    const event = on(laptop, () =>
      listEvents({ limit: 50 }).find((e) => e.event_type === 'SYNC_DOUBLE_CLAIM')
    );
    expect(event).toBeDefined();
    const payload = JSON.parse(event!.payload_json ?? '{}');
    expect(payload.local_claim).toBe('agent-on-the-laptop');
    expect(payload.remote_claim).toBe('agent-in-the-cloud');
  });

  it('does not flag a double claim when only one side claimed', () => {
    const prompt = on(laptop, () => insertPrompt({ prompt: 'Do the thing' }));
    sync(laptop, cloud);

    on(cloud, () => claimPrompt(prompt.uuid, 'agent-in-the-cloud'));
    const result = sync(cloud, laptop);

    expect(result.prompts.updated).toBe(1);
    expect(result.prompts.conflicts).toBe(0);
  });
});

describe('conflicts', () => {
  it('records the discarded version when a remote edit overrides a local one', () => {
    const task = on(laptop, () => createTask({ title: 'original', status: 'BACKLOG' }));
    sync(laptop, cloud);

    on(laptop, () => updateTask(task.public_id, { title: 'edited on the laptop' }));

    // Three cloud edits put its clock strictly ahead, so the winner is decided
    // by the clock rather than by the origin tiebreak and the test is stable.
    on(cloud, () => {
      updateTask(task.public_id, { title: 'first' });
      updateTask(task.public_id, { title: 'second' });
      updateTask(task.public_id, { title: 'edited in the cloud' });
    });

    const result = sync(cloud, laptop);

    expect(result.tasks.conflicts).toBe(1);
    expect(on(laptop, () => getTask(task.public_id))?.title).toBe('edited in the cloud');

    // Nothing is lost: the overwritten version is in the task's history.
    const conflict = on(laptop, () =>
      listEvents({ taskId: getTask(task.public_id)!.id }).find(
        (event) => event.event_type === 'SYNC_CONFLICT'
      )
    );
    expect(conflict).toBeDefined();
    const payload = JSON.parse(conflict!.payload_json ?? '{}');
    expect(payload.discarded_local.title).toBe('edited on the laptop');
    expect(payload.applied_remote.title).toBe('edited in the cloud');
  });

  it('does not treat receiving a newer version of the peer own edit as a conflict', () => {
    const task = on(laptop, () => createTask({ title: 'original' }));
    sync(laptop, cloud);

    // Only the cloud edits; the laptop has not touched it since.
    on(cloud, () => updateTask(task.public_id, { title: 'edited in the cloud' }));
    const result = sync(cloud, laptop);

    expect(result.tasks.updated).toBe(1);
    expect(result.tasks.conflicts).toBe(0);
  });

  it('keeps the local version when it is the later one', () => {
    const task = on(laptop, () => createTask({ title: 'original' }));
    const stale = on(laptop, () => exportChangeset(0));

    on(laptop, () => updateTask(task.public_id, { title: 'newer' }));
    const result = on(laptop, () => applyChangeset(stale));

    expect(result.tasks.skipped).toBe(1);
    expect(on(laptop, () => getTask(task.public_id))?.title).toBe('newer');
  });

  it('resolves a tie the same way on both sides', () => {
    // Equal clocks must not depend on which peer happens to merge first.
    const task = on(laptop, () => createTask({ title: 'original' }));
    sync(laptop, cloud);

    on(laptop, () => updateTask(task.public_id, { title: 'laptop' }));
    on(cloud, () => updateTask(task.public_id, { title: 'cloud' }));

    sync(laptop, cloud);
    sync(cloud, laptop);
    // A second round settles both sides on the same answer.
    sync(laptop, cloud);

    expect(on(laptop, () => getTask(task.public_id))?.title).toBe(
      on(cloud, () => getTask(task.public_id))?.title
    );
  });
});

describe('public ids', () => {
  it('relabels an arriving task when its id is already taken here', () => {
    // Neither side has met the other, so both mint TASK-001.
    on(laptop, () => createTask({ title: 'laptop task' }));
    on(cloud, () => createTask({ title: 'cloud task' }));

    sync(laptop, cloud);

    const ids = on(cloud, () => listTasks().map((task) => task.public_id));
    expect(new Set(ids).size).toBe(2);
    expect(on(cloud, () => listTasks()).map((t) => t.title).sort()).toEqual([
      'cloud task',
      'laptop task'
    ]);

    // The relabelling is recorded rather than being silent.
    const renumbered = on(cloud, () =>
      listEvents({ limit: 50 }).find((event) => event.event_type === 'SYNC_RENUMBERED')
    );
    expect(renumbered).toBeDefined();
  });

  it('agrees on identity even when pre-pairing labels differ', () => {
    // Each side had independent work before they ever met, so both used
    // TASK-001 for a different task.
    on(laptop, () => createTask({ title: 'laptop task' }));
    on(cloud, () => createTask({ title: 'cloud task' }));

    sync(laptop, cloud);
    sync(cloud, laptop);
    sync(laptop, cloud);

    const byUuid = (peer: Peer) =>
      Object.fromEntries(on(peer, () => listTasks()).map((t) => [t.uuid, t.title]));

    // The uuid is the identity and always agrees. The label may not: renaming
    // a task that already exists would break every reference to it, so the
    // side that owns a pre-pairing id keeps it.
    expect(byUuid(laptop)).toEqual(byUuid(cloud));
    expect(Object.keys(byUuid(laptop))).toHaveLength(2);

    // Within one peer, labels are still unique — nothing is ambiguous locally.
    for (const peer of [laptop, cloud]) {
      const ids = on(peer, () => listTasks().map((t) => t.public_id));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('stops the two origins minting from the same range once they are paired', () => {
    on(laptop, () => createTask({ title: 'laptop task' }));
    sync(laptop, cloud);
    sync(cloud, laptop);

    // After pairing, exactly one of the two keeps the bare TASK-NNN range.
    const next = [
      on(laptop, () => createTask({ title: 'later on the laptop' }).public_id),
      on(cloud, () => createTask({ title: 'later in the cloud' }).public_id)
    ];
    expect(next[0]).not.toBe(next[1]);
    expect(next.filter((id) => /^TASK-\d+$/.test(id))).toHaveLength(1);
  });
});


describe('shared contexts', () => {
  it('carries a document across, body included', () => {
    on(laptop, () =>
      writeContext({ slug: 'sync-merge', title: 'Merge', purpose: 'Por que Lamport', body: '# uno' })
    );

    sync(laptop, cloud);

    const arrived = on(cloud, () => getContext('sync-merge'))!;
    expect(arrived.title).toBe('Merge');
    expect(arrived.body).toBe('# uno');
    expect(arrived.purpose).toBe('Por que Lamport');
  });

  /**
   * The case a random uuid would have broken. Two machines that never spoke
   * both write "decisions" — which is what a shared name is for — and the slug
   * is unique, so two rows cannot both land. Deriving the uuid from the slug
   * makes them the same row before the merge ever looks.
   */
  it('treats the same slug written independently as one document', () => {
    on(laptop, () => writeContext({ slug: 'decisions', title: 'Decisiones', body: 'del laptop' }));
    on(cloud, () => writeContext({ slug: 'decisions', title: 'Decisiones', body: 'del cloud' }));

    expect(() => sync(laptop, cloud)).not.toThrow();

    expect(on(cloud, () => getContext('decisions'))).not.toBeNull();
  });

  it('gives two projects their own document under the same name', () => {
    const onLaptop = on(laptop, () => writeContext({ slug: 'decisions', title: 'A' }));
    const onCloud = on(cloud, () => writeContext({ slug: 'decisions', title: 'B' }));

    // Same slug, different project: the namespace keeps them apart.
    expect(onLaptop.uuid).not.toBe(onCloud.uuid);
  });

  it('resolves a concurrent edit last-write-wins, like any other row', () => {
    on(laptop, () => writeContext({ slug: 'sync-merge', title: 'Merge', body: 'original' }));
    sync(laptop, cloud);

    on(cloud, () => writeContext({ slug: 'sync-merge', body: 'editado en el cloud' }));
    sync(cloud, laptop);

    expect(on(laptop, () => getContext('sync-merge'))!.body).toBe('editado en el cloud');
  });

  /**
   * A document is longer than a task title, so a discarded edit costs more.
   * The conflict event has to carry enough to get the text back, or the losing
   * side is simply gone.
   */
  it('keeps the discarded text recoverable from the conflict event', () => {
    on(laptop, () => writeContext({ slug: 'sync-merge', title: 'Merge', body: 'original' }));
    sync(laptop, cloud);

    on(laptop, () => writeContext({ slug: 'sync-merge', body: 'lo que escribi en el laptop' }));
    // Three cloud edits put its clock strictly ahead, so the winner is decided
    // by the clock rather than by the origin tiebreak and the test is stable.
    on(cloud, () => {
      writeContext({ slug: 'sync-merge', body: 'uno' });
      writeContext({ slug: 'sync-merge', body: 'dos' });
      writeContext({ slug: 'sync-merge', body: 'lo que escribi en el cloud' });
    });
    sync(cloud, laptop);

    const conflict = on(laptop, () =>
      listEvents({ limit: 20 }).find((event) => event.event_type === 'SYNC_CONFLICT')
    );
    expect(conflict).toBeDefined();

    const payload = JSON.parse(conflict!.payload_json ?? 'null') as {
      table: string;
      discarded_local: { body: string };
    };
    expect(payload.table).toBe('shared_contexts');
    expect(payload.discarded_local.body).toBe('lo que escribi en el laptop');
  });
});
