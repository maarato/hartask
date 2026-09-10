import { NextResponse } from 'next/server';
import { getContext } from '@/lib/hartask/repositories/contexts';

export const dynamic = 'force-dynamic';

/**
 * One document, body included.
 *
 * The bootstrap promises that every operation MCP offers is also plain HTTP on
 * the same port, so a host without MCP is not left able to see that documents
 * exist and unable to open one.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let document;
  try {
    document = getContext(slug);
  } catch (error) {
    // A slug that normalises to nothing is a bad request, not a missing page.
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }

  if (!document) {
    return NextResponse.json(
      { error: `No shared context named ${slug}. GET /api/contexts lists them.` },
      { status: 404 }
    );
  }

  return NextResponse.json({ document });
}
