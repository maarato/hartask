import { NextResponse } from 'next/server';
import { HARTASK_AGENT_CONTRACT, HARTASK_AVAILABLE_INTERFACE } from '@/lib/hartask/contract';
import { hartaskTools } from '@/lib/mcp/tools';

export async function GET() {
  return NextResponse.json({
    transport: 'placeholder',
    instructions: HARTASK_AGENT_CONTRACT,
    // What an agent can call right now. Kept separate from the planned tool
    // names below so this route never advertises a capability that does not
    // exist: an agent acting on it would fail on its first call.
    available_interface: HARTASK_AVAILABLE_INTERFACE,
    planned_tools: hartaskTools,
    tools: [],
    note: 'Not an MCP endpoint yet. Use the HTTP API described in available_interface. Replace this placeholder with an MCP Streamable HTTP implementation on the same /mcp route.'
  });
}
