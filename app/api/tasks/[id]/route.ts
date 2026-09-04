import { NextResponse } from 'next/server';
import {
  addNote,
  getTask,
  listEvents,
  listNotes,
  updateTask
} from '@/lib/hartask/repositories/tasks';
import { isTaskStatus } from '@/lib/hartask/types';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Accepts either the public id (TASK-001) or the numeric row id. */
function reference(id: string): number | string {
  return /^\d+$/.test(id) ? Number(id) : id;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const task = getTask(reference(id));
  if (!task) return NextResponse.json({ error: `Task not found: ${id}` }, { status: 404 });

  return NextResponse.json({
    task,
    notes: listNotes(task.id),
    events: listEvents({ taskId: task.id })
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const task = getTask(reference(id));
  if (!task) return NextResponse.json({ error: `Task not found: ${id}` }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.status !== undefined && !isTaskStatus(body.status)) {
    return NextResponse.json({ error: `Invalid status: ${String(body.status)}` }, { status: 400 });
  }

  const updated = updateTask(task.id, {
    title: typeof body.title === 'string' ? body.title : undefined,
    description: typeof body.description === 'string' ? body.description : undefined,
    status: isTaskStatus(body.status) ? body.status : undefined,
    priority: typeof body.priority === 'number' ? body.priority : undefined,
    nextAction: typeof body.next_action === 'string' ? body.next_action : undefined,
    blockedReason: typeof body.blocked_reason === 'string' ? body.blocked_reason : undefined,
    agentId: typeof body.agent_id === 'string' ? body.agent_id : null
  });

  if (typeof body.note === 'string' && body.note.trim()) {
    addNote(updated.id, body.note.trim(), 'agent');
  }

  return NextResponse.json({ task: updated });
}
