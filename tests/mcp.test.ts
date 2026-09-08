import { beforeEach, describe, expect, it } from 'vitest';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createPrompt } from '@/lib/hartask/repositories/prompts';
import { createTask } from '@/lib/hartask/repositories/tasks';
import { createHartaskMcpServer } from '@/lib/mcp/server';
import { SingleExchangeTransport } from '@/lib/mcp/transport';
import { resetDb } from './helpers';

/** One JSON-RPC exchange against a fresh server, the way a POST does it. */
async function rpc(method: string, params?: unknown): Promise<Record<string, unknown>> {
  const server = createHartaskMcpServer();
  const transport = new SingleExchangeTransport();
  await server.connect(transport);
  try {
    const reply = await transport.exchange({
      jsonrpc: '2.0',
      id: 1,
      method,
      ...(params === undefined ? {} : { params })
    } as JSONRPCMessage);
    return reply as unknown as Record<string, unknown>;
  } finally {
    await server.close();
  }
}

/** Calls a tool and parses the JSON its text content carries. */
async function callTool(name: string, args: Record<string, unknown> = {}) {
  const reply = await rpc('tools/call', { name, arguments: args });
  const result = reply.result as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  const text = result.content[0].text;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  // Tool output is arbitrary JSON by design, so the shape is asserted in the
  // test rather than declared here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { isError: Boolean(result.isError), text, data: parsed as any };
}

beforeEach(() => resetDb());

describe('handshake', () => {
  it('negotiates a protocol version and names the server', async () => {
    const reply = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' }
    });

    const result = reply.result as Record<string, never>;
    expect(result.serverInfo).toMatchObject({ name: 'hartask' });
    expect(result.protocolVersion).toBeTruthy();
    expect(Object.keys(result.capabilities)).toEqual(
      expect.arrayContaining(['tools', 'resources'])
    );
  });

  it('answers a notification with nothing at all', async () => {
    const server = createHartaskMcpServer();
    const transport = new SingleExchangeTransport();
    await server.connect(transport);

    // A notification carries no id, so waiting for a reply would hang forever.
    const reply = await transport.exchange({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    } as JSONRPCMessage);

    expect(reply).toBeNull();
    await server.close();
  });

  it('refuses a method it does not have', async () => {
    const reply = await rpc('nothing/here');
    expect((reply.error as { code: number }).code).toBe(-32601);
  });
});

describe('tools', () => {
  it('offers every operation an agent needs, and nothing it cannot use', async () => {
    const reply = await rpc('tools/list');
    const names = (reply.result as { tools: { name: string }[] }).tools.map((t) => t.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'hartask_start_session',
        'hartask_create_task',
        'hartask_claim_next_prompt',
        'hartask_update_handoff',
        'hartask_get_harness'
      ])
    );
  });

  it('reports an unscanned harness as unscanned rather than as empty', async () => {
    const { data } = await callTool('hartask_get_harness');

    // "No components" and "nobody has looked" are different answers, and an
    // agent acting on the first when the second is true would be wrong.
    expect(data.scanned).toBe(false);
    expect(data.hint).toMatch(/rescan/i);
  });

  it('starts a session on a fresh project with the onboarding attached', async () => {
    const { data } = await callTool('hartask_start_session');

    expect(data.onboarding?.first_run).toBe(true);
    expect(data.current_task).toBeNull();
  });

  it('builds a task hierarchy from nothing', async () => {
    const parent = await callTool('hartask_create_task', {
      title: 'Add authentication',
      status: 'READY'
    });
    const child = await callTool('hartask_create_task', {
      title: 'OAuth',
      parent_id: parent.data.public_id
    });

    expect(child.data.parent_id).toBe(parent.data.id);
  });

  it('says so rather than inventing a parent that is not there', async () => {
    const result = await callTool('hartask_create_task', {
      title: 'orphan',
      parent_id: 'TASK-999'
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/i);
  });

  it('claims a prompt and closes the attempt', async () => {
    createPrompt({ prompt: 'Analyze the current auth', status: 'READY' });

    const claim = await callTool('hartask_claim_next_prompt', { agent_id: 'agent-one' });
    expect(claim.data.prompt.status).toBe('CLAIMED');

    const failed = await callTool('hartask_fail_prompt', {
      id: claim.data.prompt.uuid,
      error: 'the provider is not configured'
    });
    // Failing returns it to the queue, which is why the run history matters.
    expect(failed.data.prompt.status).toBe('READY');
    expect(failed.data.run.status).toBe('FAILED');
  });

  it('reports an empty queue instead of failing', async () => {
    const result = await callTool('hartask_claim_next_prompt', { agent_id: 'agent-one' });

    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/empty/i);
  });

  it('refuses a handoff that says nothing', async () => {
    const result = await callTool('hartask_update_handoff', {});

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/at least one of/i);
  });
});

describe('resources', () => {
  it('lists the hartask:// resources', async () => {
    const reply = await rpc('resources/list');
    const uris = (reply.result as { resources: { uri: string }[] }).resources.map((r) => r.uri);

    expect(uris).toEqual(
      expect.arrayContaining(['hartask://tasks', 'hartask://tasks/current', 'hartask://prompts/queue'])
    );
  });

  it('reads the current task', async () => {
    const task = createTask({ title: 'Add authentication', status: 'IN_PROGRESS' });

    const reply = await rpc('resources/read', { uri: 'hartask://tasks/current' });
    const contents = (reply.result as { contents: { uri: string; text: string }[] }).contents;

    expect(JSON.parse(contents[0].text).public_id).toBe(task.public_id);
    expect(contents[0].uri).toBe('hartask://tasks/current');
  });
});
