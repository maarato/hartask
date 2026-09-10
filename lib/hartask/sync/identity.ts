import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/db/client';

export { uuidForName } from '@/lib/hartask/sync/uuid';

export type SyncOrigin = {
  id: string;
  label: string;
  public_id_prefix: string;
  is_local: number;
  lamport: number;
  created_at: string;
};

/**
 * Identity for bidirectional sync.
 *
 * Row ids are per-database, so they cannot identify a task across machines: a
 * uuid does. Ordering uses a Lamport counter rather than a wall clock, because
 * two machines with skewed clocks would otherwise disagree about which write
 * happened later — and the one running fast would win every conflict.
 */

export function localOrigin(): SyncOrigin {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM sync_origins WHERE is_local = 1`).get() as
    | SyncOrigin
    | undefined;
  if (existing) return existing;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO sync_origins (id, label, public_id_prefix, is_local, lamport)
     VALUES (?, 'local', '', 1, 0)`
  ).run(id);
  return db.prepare(`SELECT * FROM sync_origins WHERE id = ?`).get(id) as SyncOrigin;
}

/** Deterministic prefix for an origin that has to stop using the bare range. */
function prefixFor(originId: string): string {
  const letters = originId.replace(/[^a-z]/gi, '').toUpperCase();
  return letters.slice(0, 2) || 'X';
}

/**
 * Records a peer, and settles which of the two origins keeps minting bare
 * TASK-001 ids.
 *
 * Two databases that were never paired both believe they are the original, so
 * both mint from the same range. On pairing, the origin with the larger uuid
 * adopts a prefix for its future ids — a rule both sides compute independently
 * and agree on, with no negotiation. Ids already created keep their labels:
 * renumbering them would break every reference in notes, handoffs and the
 * user's own memory. Collisions among those are resolved when they arrive.
 */
export function registerOrigin(id: string, label: string): SyncOrigin {
  const db = getDb();
  const local = localOrigin();

  const existing = db.prepare(`SELECT * FROM sync_origins WHERE id = ?`).get(id) as
    | SyncOrigin
    | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO sync_origins (id, label, public_id_prefix, is_local, lamport)
       VALUES (?, ?, ?, 0, 0)`
    ).run(id, label, prefixFor(id));
  }

  // Of the two, the larger uuid yields the bare TASK-NNN range for tasks it
  // creates from now on. Tasks that already exist keep their labels: renaming
  // them would break every reference in notes, handoffs and the user's memory,
  // which is a worse failure than two peers labelling one task differently.
  if (local.public_id_prefix === '' && local.id > id) {
    db.prepare(`UPDATE sync_origins SET public_id_prefix = ? WHERE id = ?`).run(
      prefixFor(local.id),
      local.id
    );
  }

  return db.prepare(`SELECT * FROM sync_origins WHERE id = ?`).get(id) as SyncOrigin;
}

export function listOrigins(): SyncOrigin[] {
  return getDb()
    .prepare(`SELECT * FROM sync_origins ORDER BY is_local DESC, created_at ASC`)
    .all() as SyncOrigin[];
}

/**
 * Next value of the local Lamport clock. Every local write takes one, so the
 * counter only ever moves forward and a merge can tell which version is newer.
 */
export function nextLamport(): number {
  const db = getDb();
  const origin = localOrigin();
  db.prepare(`UPDATE sync_origins SET lamport = lamport + 1 WHERE id = ?`).run(origin.id);
  return (
    db.prepare(`SELECT lamport FROM sync_origins WHERE id = ?`).get(origin.id) as {
      lamport: number;
    }
  ).lamport;
}

/**
 * Pulls the local clock past everything an incoming changeset carried, which
 * is what keeps the counters monotonic across origins after a merge.
 */
export function observeLamport(seen: number): void {
  const db = getDb();
  const origin = localOrigin();
  db.prepare(`UPDATE sync_origins SET lamport = MAX(lamport, ?) WHERE id = ?`).run(
    seen,
    origin.id
  );
}

export function newUuid(): string {
  return randomUUID();
}



/** Stamp applied to every locally created or updated syncable row. */
export function localStamp(): { uuid: string; origin: string; lamport: number } {
  return { uuid: newUuid(), origin: localOrigin().id, lamport: nextLamport() };
}
