import { NextResponse } from 'next/server';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { HARTASK_AGENT_CONTRACT, HARTASK_AVAILABLE_INTERFACE } from '@/lib/hartask/contract';
import { createHartaskMcpServer, hartaskToolNames } from '@/lib/mcp/server';
import { SingleExchangeTransport } from '@/lib/mcp/transport';

/**
 * Serves MCP on whatever route mounts it, so /mcp and /api/mcp are the same
 * server rather than two that can drift.
 */

const PARSE_ERROR = { code: -32700, message: 'Parse error' };

function rpcError(id: unknown, error: { code: number; message: string }) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error }, { status: 400 });
}

export async function handleMcpPost(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpcError(null, PARSE_ERROR);
  }

  const server = createHartaskMcpServer();

  try {
    // A batch is answered as a batch; the spec dropped batching in later
    // revisions, but accepting one costs a loop and refusing it costs a client.
    const messages = Array.isArray(payload) ? payload : [payload];
    const replies: JSONRPCMessage[] = [];

    for (const message of messages) {
      const transport = new SingleExchangeTransport();
      await server.connect(transport);
      const reply = await transport.exchange(message as JSONRPCMessage);
      if (reply) replies.push(reply);
    }

    // Notifications get no body: 202 says it was accepted with nothing to say.
    if (!replies.length) return new Response(null, { status: 202 });

    return NextResponse.json(Array.isArray(payload) ? replies : replies[0]);
  } finally {
    await server.close();
  }
}

/**
 * A plain GET is a person or a script looking at the endpoint, not an MCP
 * client — those POST. It answers what this server is and how to reach it.
 */
export function describeMcp(): Response {
  return NextResponse.json({
    transport: 'streamable-http',
    protocol: 'mcp',
    usage: 'POST JSON-RPC 2.0 to this URL. Start with the "initialize" method.',
    instructions: HARTASK_AGENT_CONTRACT,
    available_interface: HARTASK_AVAILABLE_INTERFACE,
    tools: hartaskToolNames(),
    resources: [
      'hartask://project',
      'hartask://project/summary',
      'hartask://tasks',
      'hartask://tasks/current',
      'hartask://prompts/queue',
      'hartask://history/recent',
      'hartask://harness'
    ],
    not_implemented: []
  });
}
