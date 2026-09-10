import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@/lib/hartask/config';
import { createTask, listEvents } from '@/lib/hartask/repositories/tasks';
import { lastSync, runSync } from '@/lib/hartask/sync/run';
import { createPeer, on, type Peer } from './peers';

/**
 * What the sync button leaves behind.
 *
 * The button cannot throw at the user: a refusal is the guard working, and an
 * unhandled error would present the one thing standing between two boards and
 * a merge as if the app had broken. So the outcome lives in the event trail,
 * and this is where that contract is pinned.
 */

let store: string;
let laptop: Peer;
let desktop: Peer;

function pointAtStore(projectId?: string): void {
  process.env.HARTASK_SYNC_URL = `file:${store}`;
  delete process.env.HARTASK_SYNC_TOKEN;
  if (projectId) process.env.HARTASK_SYNC_PROJECT_ID = projectId;
  else delete process.env.HARTASK_SYNC_PROJECT_ID;
  resetConfigCache();
}

/** A URL that cannot work, to produce a failure that is not a refusal. */
function pointAtNothing(): void {
  process.env.HARTASK_SYNC_URL = 'https://hartask.invalid';
  delete process.env.HARTASK_SYNC_TOKEN;
  delete process.env.HARTASK_SYNC_PROJECT_ID;
  resetConfigCache();
}

function syncEvents(peer: Peer): string[] {
  return on(peer, () =>
    listEvents({ limit: 50 })
      .map((event) => event.event_type)
      .filter((type) => type.startsWith('SYNC_'))
  );
}

beforeEach(() => {
  store = join(mkdtempSync(join(tmpdir(), 'hartask-run-')), 'store.sqlite');
  laptop = createPeer('laptop-run');
  desktop = createPeer('desktop-run');
});

afterEach(() => {
  delete process.env.HARTASK_SYNC_URL;
  delete process.env.HARTASK_SYNC_TOKEN;
  delete process.env.HARTASK_SYNC_PROJECT_ID;
  resetConfigCache();
});

describe('runSync', () => {
  it('records a completed sync', async () => {
    on(laptop, () => createTask({ title: 'work' }));
    pointAtStore();

    await on(laptop, () => runSync());

    expect(on(laptop, () => lastSync())?.kind).toBe('completed');
  });

  it('records a failure that is not a refusal', async () => {
    on(laptop, () => createTask({ title: 'work' }));
    pointAtNothing();

    await expect(on(laptop, () => runSync())).rejects.toThrow();

    const outcome = on(laptop, () => lastSync());
    expect(outcome?.kind).toBe('failed');
    expect(outcome?.summary).toMatch(/no se pudo sincronizar/i);
  });

  it('reports a refusal as a refusal, not as a failure', async () => {
    on(laptop, () => createTask({ title: 'the laptop project' }));
    pointAtStore();
    const { project_uuid } = (await on(laptop, () => runSync())) as { project_uuid: string };

    // A .env.local copied onto a project that already has work of its own.
    on(desktop, () => createTask({ title: 'a different project entirely' }));
    pointAtStore(project_uuid);

    await expect(on(desktop, () => runSync())).rejects.toThrow(/merge two boards/i);

    expect(on(desktop, () => lastSync())?.kind).toBe('refused');
  });

  // The two are different answers: one says the configuration is wrong and has
  // a way out, the other says the network broke. Recording both would tell the
  // user to check their connection over a problem that is not in the network.
  it('does not also record a refusal as a failure', async () => {
    on(laptop, () => createTask({ title: 'the laptop project' }));
    pointAtStore();
    const { project_uuid } = (await on(laptop, () => runSync())) as { project_uuid: string };

    on(desktop, () => createTask({ title: 'a different project entirely' }));
    pointAtStore(project_uuid);
    await on(desktop, () => runSync()).catch(() => undefined);

    expect(syncEvents(desktop)).toEqual(['SYNC_REFUSED']);
  });

  it('carries the configured id, so the page can name what is wrong', async () => {
    on(laptop, () => createTask({ title: 'the laptop project' }));
    pointAtStore();
    const { project_uuid } = (await on(laptop, () => runSync())) as { project_uuid: string };

    on(desktop, () => createTask({ title: 'a different project entirely' }));
    pointAtStore(project_uuid);
    await on(desktop, () => runSync()).catch(() => undefined);

    const detail = on(desktop, () => lastSync())?.detail as { configured?: string };
    expect(detail.configured).toBe(project_uuid);
  });
});

describe('lastSync', () => {
  it('says nothing before anything has been tried', () => {
    expect(on(laptop, () => lastSync())).toBeNull();
  });

  // The notice has to clear itself, or a fixed configuration keeps showing a
  // warning about a problem that is no longer there.
  it('reports the most recent attempt, so a success clears an earlier failure', async () => {
    on(laptop, () => createTask({ title: 'work' }));

    pointAtNothing();
    await on(laptop, () => runSync()).catch(() => undefined);
    expect(on(laptop, () => lastSync())?.kind).toBe('failed');

    pointAtStore();
    await on(laptop, () => runSync());

    expect(on(laptop, () => lastSync())?.kind).toBe('completed');
  });
});
