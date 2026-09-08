import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfigCache } from '@/lib/hartask/config';
import { createTask, listTasks } from '@/lib/hartask/repositories/tasks';
import { exportChangeset } from '@/lib/hartask/sync/changeset';
import { receiveExchange, verifySyncToken } from '@/lib/hartask/sync/peer';
import { createPeer, on, type Peer } from './peers';
import { resetDb } from './helpers';

function setToken(token: string | undefined) {
  if (token === undefined) delete process.env.HARTASK_SYNC_TOKEN;
  else process.env.HARTASK_SYNC_TOKEN = token;
  resetConfigCache();
}

beforeEach(() => {
  resetDb();
  setToken('a-shared-secret');
});

afterEach(() => setToken(undefined));

describe('verifySyncToken', () => {
  it('refuses everything while no secret is configured', () => {
    setToken(undefined);
    const result = verifySyncToken('Bearer anything');

    // Closed by default: an open endpoint would hand the board to anyone who
    // finds the URL.
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.why).toMatch(/not configured/i);
  });

  it('accepts the configured secret, with or without the Bearer prefix', () => {
    expect(verifySyncToken('Bearer a-shared-secret').ok).toBe(true);
    expect(verifySyncToken('a-shared-secret').ok).toBe(true);
  });

  it('rejects a wrong secret, a missing one and a longer one', () => {
    expect(verifySyncToken('Bearer wrong').ok).toBe(false);
    expect(verifySyncToken(null).ok).toBe(false);
    expect(verifySyncToken('Bearer a-shared-secret-plus').ok).toBe(false);
  });
});

describe('receiveExchange', () => {
  let laptop: Peer;
  let cloud: Peer;

  beforeEach(() => {
    laptop = createPeer('laptop-http');
    cloud = createPeer('cloud-http');
  });

  it('merges the incoming changeset and answers with its own', () => {
    on(laptop, () => createTask({ title: 'from the laptop' }));
    const incoming = on(laptop, () => exportChangeset(0));

    const answer = on(cloud, () => {
      createTask({ title: 'from the cloud' });
      return receiveExchange(incoming);
    });

    expect(answer.merged.tasks.inserted).toBe(1);
    // The answer is exported after merging, so one round trip is enough for
    // the caller to converge.
    expect(answer.changeset.tasks.map((task) => task.title).sort()).toEqual([
      'from the cloud',
      'from the laptop'
    ]);
    expect(on(cloud, () => listTasks()).length).toBe(2);
  });

  it('refuses a body that is not a changeset', () => {
    expect(() => receiveExchange({ tasks: 'nope' })).toThrow(/not a changeset/i);
    expect(() => receiveExchange(null)).toThrow(/not a changeset/i);
  });
});
