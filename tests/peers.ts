import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb } from '@/lib/db/client';
import { resetConfigCache } from '@/lib/hartask/config';

/**
 * Two independent Hartask databases driven from one process, which is what
 * syncing against a remote actually is: export here, apply there.
 */
export type Peer = { name: string; database: string };

export function createPeer(name: string): Peer {
  return { name, database: join(mkdtempSync(join(tmpdir(), `hartask-${name}-`)), 'hartask.sqlite') };
}

/** Runs fn with that peer's database active, and returns its result. */
export function on<T>(peer: Peer, fn: () => T): T {
  closeDb();
  process.env.HARTASK_DATABASE = peer.database;
  resetConfigCache();
  return fn();
}
