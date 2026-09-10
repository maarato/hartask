import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createPrompt } from '@/lib/hartask/repositories/prompts';
import { getDb } from '@/lib/db/client';
import { resetConfigCache, syncSettings } from '@/lib/hartask/config';
import { createTask } from '@/lib/hartask/repositories/tasks';
import { listOrigins } from '@/lib/hartask/sync/identity';
import { createHartaskMcpServer, hartaskToolNames } from '@/lib/mcp/server';
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
        'hartask_sync',
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

describe('sync', () => {
  /**
   * The board only reaches a store when someone runs a sync, so the tool is
   * the agent's half of that. What is pinned here is mostly what it refuses:
   * sending a whole board off the machine is not a call it gets to make alone.
   */

  let store: string;

  beforeEach(() => {
    store = join(mkdtempSync(join(tmpdir(), 'hartask-mcp-sync-')), 'store.sqlite');
    // resetDb leaves sync_origins alone — it is this database's identity, not
    // its content — so a sync in one test would otherwise count as pairing in
    // the next and the confirmation guard would look already satisfied.
    getDb().prepare(`DELETE FROM sync_origins WHERE is_local = 0`).run();
    delete process.env.HARTASK_SYNC_URL;
    delete process.env.HARTASK_SYNC_TOKEN;
    resetConfigCache();
  });

  afterEach(() => {
    delete process.env.HARTASK_SYNC_URL;
    delete process.env.HARTASK_SYNC_TOKEN;
    resetConfigCache();
  });

  function pointAtStore(): void {
    process.env.HARTASK_SYNC_URL = `file:${store}`;
    resetConfigCache();
    // The tool reads it, so a misconfigured test would be indistinguishable
    // from the guard it is trying to exercise.
    expect(syncSettings().url).toBe(`file:${store}`);
  }

  it('says there is nowhere to send the board rather than failing obscurely', async () => {
    const result = await callTool('hartask_sync');

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/no sync is configured/i);
  });

  it('will not run the first sync without the user behind it', async () => {
    createTask({ title: 'local work' });
    pointAtStore();

    const result = await callTool('hartask_sync');

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/confirm_first_sync/);
    // Refusing has to mean nothing was uploaded, not that the upload happened
    // and the message was written afterwards.
    expect(existsSync(store)).toBe(false);
    expect(listOrigins().filter((origin) => !origin.is_local)).toHaveLength(0);
  });

  it('syncs once the user has agreed, and stops asking afterwards', async () => {
    createTask({ title: 'local work' });
    pointAtStore();

    const first = await callTool('hartask_sync', { confirm_first_sync: true });
    expect(first.isError).toBe(false);
    expect(first.data.last_sync).toMatchObject({ kind: 'completed' });

    // The pairing is what the guard reads, so the second call needs no flag.
    const second = await callTool('hartask_sync');
    expect(second.isError).toBe(false);
  });

  it('reports a broken remote as a failure without pretending it synced', async () => {
    createTask({ title: 'local work' });
    process.env.HARTASK_SYNC_URL = 'https://hartask.invalid';
    process.env.HARTASK_SYNC_TOKEN = 'shared-secret';
    resetConfigCache();

    const result = await callTool('hartask_sync', { confirm_first_sync: true });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/sync failed/i);
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


describe('shared context tools', () => {
  it('writes a document and reads it back in full', async () => {
    await callTool('hartask_write_context_doc', {
      slug: 'sync-merge',
      title: 'Como decide el merge',
      purpose: 'Por que Lamport y no reloj de pared',
      body: '# Merge'
    });

    const { data } = await callTool('hartask_get_context_doc', { slug: 'sync-merge' });
    expect(data.title).toBe('Como decide el merge');
    expect(data.body).toBe('# Merge');
  });

  it('corrects a document in place instead of stacking versions', async () => {
    await callTool('hartask_write_context_doc', { slug: 'sync-merge', title: 'Merge', body: 'uno' });
    await callTool('hartask_write_context_doc', { slug: 'sync-merge', body: 'dos' });

    const { data } = await callTool('hartask_get_context_doc', { slug: 'sync-merge' });
    expect(data).toMatchObject({
      title: 'Merge',
      body: 'dos'
    });
  });

  it('says which document is missing rather than answering with nothing', async () => {
    const { isError, data } = await callTool('hartask_get_context_doc', { slug: 'no-existe' });

    expect(isError).toBe(true);
    expect(String(data)).toMatch(/no-existe/);
  });

  // A new document with no title, or a slug that is not usable, are the
  // caller's to fix — so the tool has to say which, not fail opaquely.
  it('reports a bad write as an error the caller can act on', async () => {
    const missingTitle = await callTool('hartask_write_context_doc', { slug: 'sin-titulo' });
    expect(missingTitle.isError).toBe(true);
    expect(String(missingTitle.data)).toMatch(/title/i);

    const badSlug = await callTool('hartask_write_context_doc', { slug: '!!!', title: 'x' });
    expect(badSlug.isError).toBe(true);
    expect(String(badSlug.data)).toMatch(/slug/i);
  });

  // The description is the only thing an agent reads without fail, so the
  // boundary against handoffs, notes and Project Context lives in it.
  it('carries the boundary in the write tool description', async () => {
    const reply = await rpc('tools/list');
    const tools = (reply.result as { tools: { name: string; description: string }[] }).tools;
    const write = tools.find((tool) => tool.name === 'hartask_write_context_doc')!;

    expect(write.description).toMatch(/handoff/i);
    expect(write.description).toMatch(/note/i);
    expect(write.description).toMatch(/Project Context/i);
  });

  it('offers both tools, and the discovery response agrees', async () => {
    const reply = await rpc('tools/list');
    const names = (reply.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);

    expect(names).toContain('hartask_get_context_doc');
    expect(names).toContain('hartask_write_context_doc');
    expect(hartaskToolNames()).toEqual(expect.arrayContaining(names));
  });
});
