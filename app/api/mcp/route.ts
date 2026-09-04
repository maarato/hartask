import { NextResponse } from 'next/server';
import { HARTASK_AGENT_CONTRACT } from '@/lib/hartask/contract';
import { hartaskTools } from '@/lib/mcp/tools';

export async function GET(){
  return NextResponse.json({
    transport:'placeholder',
    instructions:HARTASK_AGENT_CONTRACT,
    tools:hartaskTools,
    note:'Replace this placeholder with an MCP Streamable HTTP implementation on the same /mcp route.'
  });
}
