import { NextResponse } from 'next/server';
import { syncSettings } from '@/lib/hartask/config';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import { listEvents } from '@/lib/hartask/repositories/tasks';
import { listOrigins } from '@/lib/hartask/sync/identity';
import { receiveExchange, verifySyncToken } from '@/lib/hartask/sync/peer';
import { isRemoteStoreUrl, SyncRefusedError } from '@/lib/hartask/sync/remote';
import { runSync } from '@/lib/hartask/sync/run';

export const dynamic = 'force-dynamic';

/** Status. Never reveals the token — only whether one is configured. */
export async function GET() {
  const { url, token } = syncSettings();
  const last = listEvents({ limit: 200 }).find((event) => event.event_type === 'SYNC_COMPLETED');

  return NextResponse.json({
    configured: Boolean(url) && (isRemoteStoreUrl(url) || Boolean(token)),
    mode: url ? (isRemoteStoreUrl(url) ? 'remote-store' : 'hartask-peer') : null,
    url: url || null,
    token_configured: Boolean(token),
    // The id a second machine needs so it joins this project rather than
    // creating an empty one of its own in the store.
    project_uuid: ensureProject().uuid,
    origins: listOrigins().map((origin) => ({
      id: origin.id,
      label: origin.label,
      public_id_prefix: origin.public_id_prefix,
      is_local: Boolean(origin.is_local),
      lamport: origin.lamport
    })),
    last_sync: last
      ? { at: last.created_at, detail: JSON.parse(last.payload_json ?? 'null') }
      : null
  });
}

/**
 * Two roles on one route.
 *
 * A peer POSTs its changeset with the shared secret, and gets ours back: one
 * request is a full exchange. Locally, POSTing `{"action":"sync"}` without a
 * token starts the outbound side instead.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const authorization = request.headers.get('authorization');

  if (!authorization && (body as { action?: string })?.action === 'sync') {
    try {
      // adopt_project is a parameter of the call rather than a setting, so the
      // override cannot travel inside a copied .env.local.
      const adoptProject = (body as { adopt_project?: unknown })?.adopt_project === true;
      return NextResponse.json(await runSync({ adoptProject }));
    } catch (error) {
      // A refusal is a conflict in how this instance is configured, not a
      // failure to reach the other side.
      const status = error instanceof SyncRefusedError ? 409 : 502;
      return NextResponse.json({ error: (error as Error).message, refused: status === 409 }, { status });
    }
  }

  const auth = verifySyncToken(authorization);
  if (!auth.ok) {
    // 404 rather than 401 when sync is switched off: an instance that is not
    // participating should not advertise that the endpoint exists.
    const closed = auth.why.includes('not configured');
    return NextResponse.json({ error: auth.why }, { status: closed ? 404 : 401 });
  }

  try {
    return NextResponse.json(receiveExchange(body));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
