import { NextResponse } from 'next/server';
import {
  countPromptsByStatus,
  createPrompt,
  listPrompts
} from '@/lib/hartask/repositories/prompts';
import { ensureProject } from '@/lib/hartask/repositories/projects';
import { isPromptStatus, type PromptStatus } from '@/lib/hartask/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  ensureProject();

  const params = new URL(request.url).searchParams;
  const status = params.getAll('status').filter(isPromptStatus) as PromptStatus[];
  const taskId = params.get('task_id');

  return NextResponse.json({
    items: listPrompts({
      status: status.length ? status : undefined,
      taskId: taskId ? Number(taskId) : undefined
    }),
    counts: countPromptsByStatus()
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

  const text = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!text) return NextResponse.json({ error: '`prompt` is required' }, { status: 400 });

  if (body.status !== undefined && !isPromptStatus(body.status)) {
    return NextResponse.json({ error: `Invalid status: ${String(body.status)}` }, { status: 400 });
  }

  const prompt = createPrompt({
    prompt: text,
    title: typeof body.title === 'string' ? body.title : null,
    taskId: typeof body.task_id === 'number' ? body.task_id : null,
    status: isPromptStatus(body.status) ? body.status : undefined,
    priority: typeof body.priority === 'number' ? body.priority : undefined,
    position: typeof body.position === 'number' ? body.position : undefined
  });

  return NextResponse.json({ prompt }, { status: 201 });
}
