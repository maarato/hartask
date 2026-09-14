import { NextResponse } from 'next/server';
import { getContext, writeContext } from '@/lib/hartask/repositories/contexts';

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

/**
 * Writing one, for a host without MCP.
 *
 * hartask_write_context_doc could write a document and plain HTTP could only
 * read one, which the bootstrap promises is never the case. A field left out
 * keeps what the document already says, the same as through the tool.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const optional = (key: string): string | null | undefined =>
    body[key] === null ? null : typeof body[key] === 'string' ? (body[key] as string) : undefined;

  try {
    return NextResponse.json({
      document: writeContext({
        slug,
        title: typeof body.title === 'string' ? body.title : undefined,
        purpose: optional('purpose'),
        body: optional('body'),
        category: optional('category'),
        validAsOf: optional('valid_as_of'),
        agentId: typeof body.agent_id === 'string' ? body.agent_id : 'api'
      })
    });
  } catch (error) {
    // A new document with no title, or a slug that normalises to nothing.
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
