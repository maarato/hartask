import { NextResponse } from 'next/server';
import {
  completePrompt,
  failPrompt,
  getPrompt,
  listRuns,
  updatePrompt
} from '@/lib/hartask/repositories/prompts';
import { isPromptStatus } from '@/lib/hartask/types';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** Accepts the uuid or the numeric row id. */
function reference(id: string): number | string {
  return /^\d+$/.test(id) ? Number(id) : id;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const prompt = getPrompt(reference(id));
  if (!prompt) return NextResponse.json({ error: `Prompt not found: ${id}` }, { status: 404 });

  return NextResponse.json({ prompt, runs: listRuns(prompt.id) });
}

/**
 * Edits the prompt, or closes the run it is holding. `action` picks which:
 * finishing work is not the same as editing a field, and conflating them would
 * let a stray status write end a run without recording its outcome.
 */
export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const prompt = getPrompt(reference(id));
  if (!prompt) return NextResponse.json({ error: `Prompt not found: ${id}` }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.action === 'complete') {
    const summary = typeof body.summary === 'string' ? body.summary : null;
    return NextResponse.json(completePrompt(prompt.id, summary));
  }

  if (body.action === 'fail') {
    const error = typeof body.error === 'string' ? body.error.trim() : '';
    if (!error) {
      return NextResponse.json({ error: '`error` is required when failing a run' }, { status: 400 });
    }
    const retry = body.retry === undefined ? true : Boolean(body.retry);
    return NextResponse.json(failPrompt(prompt.id, error, { retry }));
  }

  if (body.action !== undefined) {
    return NextResponse.json(
      { error: `Unknown action: ${String(body.action)}. Use "complete" or "fail".` },
      { status: 400 }
    );
  }

  if (body.status !== undefined && !isPromptStatus(body.status)) {
    return NextResponse.json({ error: `Invalid status: ${String(body.status)}` }, { status: 400 });
  }

  return NextResponse.json({
    prompt: updatePrompt(prompt.id, {
      title: typeof body.title === 'string' ? body.title : undefined,
      prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
      status: isPromptStatus(body.status) ? body.status : undefined,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      position: typeof body.position === 'number' ? body.position : undefined
    })
  });
}
