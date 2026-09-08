import { timingSafeEqual } from 'node:crypto';
import { syncSettings } from '@/lib/hartask/config';
import { recordEvent } from '@/lib/hartask/repositories/tasks';
import {
  applyChangeset,
  exportChangeset,
  type Changeset,
  type MergeResult
} from '@/lib/hartask/sync/changeset';

/**
 * Sync transport: the remote peer is another Hartask instance, not a raw
 * database.
 *
 * That keeps the merge engine unchanged — each side runs it against its own
 * SQLite — and it is also what the use case needs: a database in the cloud
 * with no Hartask in front of it gives you nothing to look at or type into.
 *
 * One POST is a full exchange. We send our changeset, the peer merges it and
 * answers with its own, and we merge that. Both sides converge in a single
 * round trip.
 */

export type SyncOutcome = {
  url: string;
  pushed: MergeResult;
  pulled: MergeResult;
};

/** Rejects unless a secret is configured and matches, in constant time. */
export function verifySyncToken(header: string | null): { ok: true } | { ok: false; why: string } {
  const { token } = syncSettings();

  // Closed by default: without a configured secret an open endpoint would hand
  // the project's board to anyone who finds the URL.
  if (!token) return { ok: false, why: 'Sync is not configured on this instance' };

  const offered = header?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!offered) return { ok: false, why: 'Missing bearer token' };

  const a = Buffer.from(offered);
  const b = Buffer.from(token);
  // Compare lengths separately: timingSafeEqual throws on a mismatch, and the
  // length is not the secret.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, why: 'Invalid token' };
  }
  return { ok: true };
}

function isChangeset(value: unknown): value is Changeset {
  const candidate = value as Partial<Changeset> | null;
  return (
    !!candidate &&
    typeof candidate.origin === 'string' &&
    typeof candidate.lamport === 'number' &&
    Array.isArray(candidate.tasks) &&
    Array.isArray(candidate.notes) &&
    Array.isArray(candidate.events) &&
    Array.isArray(candidate.handoffs)
  );
}

/**
 * Sends everything, every time. Resending rows the peer already has is
 * idempotent, so this is correct but not minimal; a per-peer cursor would
 * trade that for state that has to stay right across failed exchanges.
 */
export async function syncWithPeer(): Promise<SyncOutcome> {
  const { url, token } = syncSettings();
  if (!url) throw new Error('No sync URL is configured');
  if (!token) throw new Error('No sync token is configured');

  const endpoint = new URL('/api/sync', url).toString();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(exportChangeset(0))
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Peer answered ${response.status}: ${detail.slice(0, 200)}`);
  }

  const body = (await response.json()) as { merged?: MergeResult; changeset?: unknown };
  if (!isChangeset(body.changeset)) {
    throw new Error('Peer did not answer with a changeset');
  }

  const pulled = applyChangeset(body.changeset);
  const pushed = body.merged ?? {
    tasks: { inserted: 0, updated: 0, skipped: 0, conflicts: 0 },
    notes: 0,
    events: 0,
    handoffs: 0
  };

  // Recorded as an event rather than in a table of its own: a sync is
  // something that happened to the project, which is what events are for.
  recordEvent({
    eventType: 'SYNC_COMPLETED',
    summary: `Sincronizado con ${endpoint}`,
    payload: { url: endpoint, pushed, pulled },
    agentId: 'sync'
  });

  return { url: endpoint, pushed, pulled };
}

/** Handles an incoming exchange: merge theirs, answer with ours. */
export function receiveExchange(incoming: unknown): { merged: MergeResult; changeset: Changeset } {
  if (!isChangeset(incoming)) throw new Error('Body is not a changeset');

  const merged = applyChangeset(incoming);
  // Exported after merging, so the answer already reflects what just arrived
  // and the peer does not need a second round trip to converge.
  return { merged, changeset: exportChangeset(0) };
}
