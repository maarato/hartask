import { describeMcp, handleMcpPost } from '@/lib/mcp/handler';

export const dynamic = 'force-dynamic';

/**
 * The path the README has promised since the beginning: one process, one port,
 * with the agent interface at /mcp. /api/mcp mounts the same server.
 */
export async function GET() {
  return describeMcp();
}

export async function POST(request: Request) {
  return handleMcpPost(request);
}
