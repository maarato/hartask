import { NextResponse } from 'next/server';
import { contextIndex } from '@/lib/hartask/repositories/contexts';

export const dynamic = 'force-dynamic';

/**
 * The same index the cold-start briefing carries, on its own.
 *
 * `GET /api/context` already includes it, so an agent starting work never has
 * to ask for this. It exists for the caller that wants to re-check the shelf
 * without paying for the whole briefing.
 */
export async function GET() {
  return NextResponse.json({
    documents: contextIndex(),
    read: 'GET /api/contexts/<slug>'
  });
}
