import { NextResponse } from 'next/server';
import { createHandoff, getLatestHandoff, listHandoffs } from '@/lib/hartask/repositories/handoff';
import { ensureProject } from '@/lib/hartask/repositories/projects';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  ensureProject();

  const wantsHistory = new URL(request.url).searchParams.get('history') === 'true';

  return NextResponse.json({
    handoff: getLatestHandoff(),
    ...(wantsHistory ? { history: listHandoffs() } : {})
  });
}

/**
 * Accepts the checkpoint payload documented in the README:
 * { current_task, done, current_state, next, problems, important_files,
 *   important_decisions }
 */
export async function POST(request: Request) {
  ensureProject();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const string = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  const files = Array.isArray(body.important_files)
    ? body.important_files.filter((f): f is string => typeof f === 'string')
    : null;
  const problems = Array.isArray(body.problems)
    ? body.problems.filter((p): p is string => typeof p === 'string')
    : string(body.problems);

  const meaningful =
    string(body.done) ?? string(body.current_state) ?? string(body.next) ?? problems;
  if (!meaningful) {
    return NextResponse.json(
      { error: 'A handoff needs at least one of: done, current_state, next, problems' },
      { status: 400 }
    );
  }

  const currentTask =
    typeof body.current_task === 'string' || typeof body.current_task === 'number'
      ? body.current_task
      : null;

  const handoff = createHandoff({
    currentTask,
    whatWasDone: string(body.done),
    currentState: string(body.current_state),
    nextStep: string(body.next),
    knownProblems: problems,
    importantFiles: files,
    importantDecisions: string(body.important_decisions),
    source: string(body.source) ?? 'agent-generated',
    agentRunId: string(body.agent_run_id)
  });

  return NextResponse.json({ handoff }, { status: 201 });
}
