import { NextResponse } from 'next/server';
import { contextIndex } from '@/lib/hartask/repositories/contexts';
import { promptQueueBriefing } from '@/lib/hartask/repositories/prompts';
import { onboarding } from '@/lib/hartask/onboarding';
import { getLatestHandoff } from '@/lib/hartask/repositories/handoff';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import {
  countTasksByStatus,
  getCurrentTask,
  listEvents
} from '@/lib/hartask/repositories/tasks';

export const dynamic = 'force-dynamic';

export async function GET() {
  const project = ensureProject();
  const counts = countTasksByStatus();
  const handoff = getLatestHandoff();

  // A project that has never been used gets set-up instructions instead of an
  // empty briefing that says nothing.
  const firstRun = onboarding();

  // Unconditional, and never the bodies. An agent that has to already know a
  // document exists in order to find it will never read one, which is how a
  // collection like this quietly becomes write-only.
  const contexts = contextIndex();


  return NextResponse.json({
    project: { name: project.name, root_path: project.root_path, summary: project.summary },
    current_task: getCurrentTask(),
    tasks: { counts, ready: counts.READY ?? 0, in_progress: counts.IN_PROGRESS ?? 0 },
    recent_events: listEvents({ limit: 10 }),
    handoff,
    contexts: {
      documents: contexts,
      // The index is useless without the way to open one, and an agent that
      // has none of these yet needs to be told the shelf exists before it can
      // think to put something on it.
      read: 'GET /api/contexts/<slug>, or the hartask://contexts/<slug> resource',
      ...(contexts.length
        ? {}
        : {
            note:
              'No shared contexts yet. They hold what is durable and narrower than the ' +
              'whole project — how a part works and why — so that it is not re-derived ' +
              'every session. Where it goes: what the project IS belongs in Project ' +
              'Context, where you left off in a handoff, what you found doing one task ' +
              'in a note on that task.'
          })
    },
    ...(firstRun ? { onboarding: firstRun } : {}),
    prompts: promptQueueBriefing()
  });
}
