import { NextResponse } from 'next/server';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import {
  countTasksByStatus,
  createTask,
  listTasks,
  listTaskTree
} from '@/lib/hartask/repositories/tasks';
import { isTaskStatus, type TaskStatus } from '@/lib/hartask/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  ensureProject();

  const params = new URL(request.url).searchParams;
  const status = params.getAll('status').filter(isTaskStatus) as TaskStatus[];
  const includeClosed = params.get('includeClosed') !== 'false';
  const filter = { status: status.length ? status : undefined, includeClosed };

  return NextResponse.json({
    items: listTasks(filter),
    tree: listTaskTree(filter),
    counts: countTasksByStatus()
  });
}

export async function POST(request: Request) {
  ensureProject();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: '`title` is required' }, { status: 400 });
  }
  if (body.status !== undefined && !isTaskStatus(body.status)) {
    return NextResponse.json({ error: `Invalid status: ${String(body.status)}` }, { status: 400 });
  }

  const task = createTask({
    title,
    description: typeof body.description === 'string' ? body.description : null,
    status: isTaskStatus(body.status) ? body.status : undefined,
    parentId: typeof body.parent_id === 'number' ? body.parent_id : null,
    priority: typeof body.priority === 'number' ? body.priority : undefined,
    nextAction: typeof body.next_action === 'string' ? body.next_action : null,
    agentId: typeof body.agent_id === 'string' ? body.agent_id : null
  });

  return NextResponse.json({ task }, { status: 201 });
}
