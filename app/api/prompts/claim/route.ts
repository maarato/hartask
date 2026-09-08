import { NextResponse } from 'next/server';
import { claimNextPrompt } from '@/lib/hartask/repositories/prompts';
import { ensureProject } from '@/lib/hartask/repositories/projects';

export const dynamic = 'force-dynamic';

/**
 * Claim, not get: the agent-facing operation the whole queue exists for. Two
 * agents calling this never receive the same prompt.
 */
export async function POST(request: Request) {
  ensureProject();

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // An empty body is fine; only the agent id is read from it.
  }

  const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
  if (!agentId) {
    return NextResponse.json(
      { error: '`agent_id` is required: a claim has to say who holds the work' },
      { status: 400 }
    );
  }

  const claim = claimNextPrompt(agentId);
  if (!claim) return NextResponse.json({ claimed: null, reason: 'The queue is empty' });

  return NextResponse.json({ claimed: claim.prompt, run: claim.run });
}
