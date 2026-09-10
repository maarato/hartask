import { recordEvent, listEvents } from '@/lib/hartask/repositories/tasks';
import { syncSettings } from '@/lib/hartask/config';
import { syncWithPeer, type SyncOutcome } from '@/lib/hartask/sync/peer';
import {
  isRemoteStoreUrl,
  SyncRefusedError,
  syncWithRemoteStore,
  type RemoteSyncOutcome
} from '@/lib/hartask/sync/remote';

/**
 * One place that runs a sync, whichever shape the remote is, and leaves the
 * outcome in the event trail.
 *
 * The button and the API route both used to pick the adapter themselves, which
 * meant the two entry points could drift on what counts as a failure. They ask
 * here instead.
 */

/** What the last attempt did, so a page can say so without re-running it. */
export type SyncOutcomeKind = 'completed' | 'refused' | 'failed';

export type LastSync = {
  kind: SyncOutcomeKind;
  at: string;
  summary: string | null;
  detail: unknown;
};

const EVENT_KINDS: Record<string, SyncOutcomeKind> = {
  SYNC_COMPLETED: 'completed',
  SYNC_REFUSED: 'refused',
  SYNC_FAILED: 'failed'
};

export async function runSync(
  options: { adoptProject?: boolean } = {}
): Promise<RemoteSyncOutcome | SyncOutcome> {
  const { url } = syncSettings();

  try {
    // A libsql:, file: or ws: URL is a passive store; http(s) is another
    // Hartask instance to exchange changesets with.
    return isRemoteStoreUrl(url)
      ? await syncWithRemoteStore({ adoptProject: options.adoptProject })
      : await syncWithPeer();
  } catch (error) {
    // A refusal already recorded itself, and recording it again as a failure
    // would say the network broke when the configuration is what is wrong.
    if (!(error instanceof SyncRefusedError)) {
      recordEvent({
        eventType: 'SYNC_FAILED',
        summary: `No se pudo sincronizar: ${(error as Error).message}`.slice(0, 300),
        payload: { url, message: (error as Error).message },
        agentId: 'sync'
      });
    }
    throw error;
  }
}

/**
 * The most recent thing sync did.
 *
 * Read from the event trail rather than kept in memory, so it survives the
 * re-render after a server action and reads the same whether the sync was run
 * from the button or from the API.
 */
export function lastSync(): LastSync | null {
  const event = listEvents({ limit: 200 }).find((candidate) => candidate.event_type in EVENT_KINDS);
  if (!event) return null;

  return {
    kind: EVENT_KINDS[event.event_type],
    at: event.created_at,
    summary: event.summary,
    detail: JSON.parse(event.payload_json ?? 'null')
  };
}
