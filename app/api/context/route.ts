import { NextResponse } from 'next/server';
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

  return NextResponse.json({
    project: { name: project.name, root_path: project.root_path, summary: project.summary },
    current_task: getCurrentTask(),
    tasks: { counts, ready: counts.READY ?? 0, in_progress: counts.IN_PROGRESS ?? 0 },
    recent_events: listEvents({ limit: 10 }),
    handoff: getLatestHandoff(),
    // Not implemented yet: the prompt repository is the next phase in
    // docs/NEXT-STEPS.md.
    prompts: { queue: null, note: 'TODO: prompt stack repository' }
  });
}
